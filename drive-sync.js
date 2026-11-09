// ═══════════════════════════════════════════════════════════════
// Google Drive 同期 (任意機能 / drive-sync.js)
//
// データ (localStorage の kyotsu_v5) を Google Drive 上の
// kyote-data.json に自動同期する。スコープは drive.file のみ。
// 認証は Google Identity Services (GIS) のトークンクライアント方式で、
// アクセストークンはメモリ上にのみ保持する (永続化しない)。
//
// 同期ルール: last-write-wins (新しい方の updatedAt が勝つ)。マージはしない。
// 同期に失敗してもローカル保存は一切妨げない。
// ═══════════════════════════════════════════════════════════════

// ★★★ 設定 ★★★
// Google Cloud Console で作成した OAuth クライアントID (種類: Web アプリケーション) を
// 下のプレースホルダと置き換えて貼り付けてください。作成手順は SETUP.md を参照。
// このプレースホルダのままだと Drive 連携 UI は表示されず、アプリは従来通り動作します。
const DRIVE_CLIENT_ID = '1019170607018-fl1m5ps4ai3k9bncnpqfi3qbfutfekaq.apps.googleusercontent.com';

(function () {
  'use strict';

  // ── 未設定時: UI を隠すだけのスタブを公開し、従来動作を保つ ──
  if (!DRIVE_CLIENT_ID || DRIVE_CLIENT_ID.indexOf('YOUR_CLIENT_ID') === 0) {
    var hideSection = function () {
      var sec = document.getElementById('driveSyncSection');
      if (sec) sec.style.display = 'none';
    };
    window.KyoteDrive = { refreshUI: hideSection, onButtonClick: function () {}, syncNow: function () {} };
    hideSection();
    return;
  }

  // ── 定数 ──
  var FILE_NAME = 'kyote-data.json';
  var LS_DATA_KEY = 'kyotsu_v5';              // 本体データ (app.js と共通)
  var LS_FILE_ID = 'kyote_drive_file_id';     // Drive 上のファイル ID
  var LS_LAST_SYNC = 'kyote_drive_last_sync'; // 最後に同期した envelope.updatedAt (ISO)
  var LS_LOCAL_AT = 'kyote_drive_local_at';   // ローカルデータの最終変更時刻 (ISO)
  var LS_ENABLED = 'kyote_drive_enabled';     // '1' = 連携済み
  var LS_HINT = 'kyote_drive_hint';           // 連携アカウントのメール (サイレント認証用)
  var SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
  var API = 'https://www.googleapis.com/drive/v3';
  var UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
  var DEBOUNCE_MS = 3000;

  // ── 状態 (メモリ上のみ) ──
  var tokenClient = null;
  var accessToken = null;
  var tokenExpiresAt = 0;
  var hadTokenThisSession = false;
  var silentTriedThisSession = false;
  var tokenWaiters = [];
  var applyingRemote = false;   // Drive → ローカルの反映中フラグ (保存フックの自己発火防止)
  var debounceTimer = null;
  var busy = false;             // 同期処理の多重実行防止

  // ── UI ──────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }

  function setStatus(text) {
    var s = el('driveSyncStatus');
    if (s) s.textContent = text;
  }

  function hhmm(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function refreshUI() {
    var sec = el('driveSyncSection');
    if (sec) sec.style.display = '';
    var label = el('driveSyncBtnLabel');
    var enabled = localStorage.getItem(LS_ENABLED) === '1';
    var lastSync = localStorage.getItem(LS_LAST_SYNC);
    if (label) label.textContent = enabled ? 'Googleドライブ連携を解除' : 'Googleドライブと連携';
    var nowBtn = el('driveSyncNowBtn');
    if (nowBtn) nowBtn.style.display = enabled && !busy ? '' : 'none';
    if (!enabled) { setStatus('未連携'); return; }
    if (busy) { setStatus('同期中…'); return; }
    if (localStorage.getItem(LS_LOCAL_AT)) { setStatus('未同期の変更あり（「今すぐ同期」で送信）'); return; }
    if (lastSync) setStatus('同期済み ' + hhmm(lastSync));
    else setStatus('連携済み（未同期）');
  }

  // app.js の buildDrawer から呼ばれる公開 API
  window.KyoteDrive = { refreshUI: refreshUI, onButtonClick: onButtonClick, syncNow: syncNow };

  // ── トークン取得 (GIS) ─────────────────────────────────────
  function ensureTokenClient() {
    if (tokenClient) return true;
    if (!window.google || !google.accounts || !google.accounts.oauth2) return false;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: DRIVE_CLIENT_ID,
      scope: SCOPE,
      callback: function (resp) {
        if (resp && resp.access_token) {
          accessToken = resp.access_token;
          tokenExpiresAt = Date.now() + (resp.expires_in ? resp.expires_in * 1000 : 3600 * 1000);
          hadTokenThisSession = true;
          flushTokenWaiters(true);
        } else {
          flushTokenWaiters(false);
        }
      },
      error_callback: function () { flushTokenWaiters(false); }
    });
    return true;
  }

  function flushTokenWaiters(ok) {
    var w = tokenWaiters;
    tokenWaiters = [];
    w.forEach(function (resolve) { resolve(ok); });
  }

  function tokenValid() {
    return !!accessToken && Date.now() < tokenExpiresAt - 30 * 1000;
  }

  // 連携アカウントのメールを userinfo から取得して保存する。
  // 次回以降のトークン取得で hint として渡すことで、サイレント認証時に
  // アカウント選択ポップアップが出なくなる。
  function captureHint() {
    if (localStorage.getItem(LS_HINT) || !accessToken) return;
    fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: 'Bearer ' + accessToken }
    }).then(function (res) { return res.ok ? res.json() : null; })
      .then(function (j) {
        if (j && j.email) localStorage.setItem(LS_HINT, j.email);
      }).catch(function () {});
  }

  // interactive=true: ユーザー操作起点 (必要なら同意画面が出る)
  // interactive=false: サイレント (prompt:'')、対話が必要なら失敗を返す
  function requestToken(interactive) {
    return new Promise(function (resolve) {
      if (tokenValid()) { resolve(true); return; }
      if (!ensureTokenClient()) { resolve(false); return; }
      tokenWaiters.push(resolve);
      try {
        var opts = interactive ? {} : { prompt: '' };
        var hint = localStorage.getItem(LS_HINT);
        if (hint) opts.hint = hint;
        tokenClient.requestAccessToken(opts);
      } catch (e) {
        flushTokenWaiters(false);
      }
    });
  }

  // 自動処理用: セッション中、未取得状態からのサイレント試行は1回まで。
  // 一度トークンが取れた後は、有効期限切れの再取得 (通常は無対話で成功) を許可する。
  function getTokenAuto() {
    if (tokenValid()) return Promise.resolve(true);
    if (silentTriedThisSession && !hadTokenThisSession) return Promise.resolve(false);
    silentTriedThisSession = true;
    return requestToken(false);
  }

  function waitForGis(cb) {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (ensureTokenClient()) { clearInterval(timer); cb(true); }
      else if (tries >= 40) { clearInterval(timer); cb(false); } // 約10秒で諦める (オフライン等)
    }, 250);
  }

  // ── Drive API ───────────────────────────────────────────────
  function driveFetch(url, options) {
    options = options || {};
    options.headers = Object.assign({}, options.headers, {
      Authorization: 'Bearer ' + accessToken
    });
    return fetch(url, options).then(function (res) {
      if (res.status !== 401) return res;
      // トークン失効 → 破棄して1回だけサイレント再取得してリトライ
      accessToken = null;
      tokenExpiresAt = 0;
      return requestToken(false).then(function (ok) {
        if (!ok) return res;
        options.headers.Authorization = 'Bearer ' + accessToken;
        return fetch(url, options);
      });
    });
  }

  function findFileId() {
    var stored = localStorage.getItem(LS_FILE_ID);
    var search = function () {
      var q = encodeURIComponent(
        "name = '" + FILE_NAME + "' and mimeType = 'application/json' and trashed = false"
      );
      return driveFetch(API + '/files?q=' + q + '&fields=files(id,name)&spaces=drive&orderBy=createdTime')
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (j) {
          if (j && j.files && j.files.length) {
            localStorage.setItem(LS_FILE_ID, j.files[0].id);
            return j.files[0].id;
          }
          return null;
        });
    };
    if (!stored) return search();
    return driveFetch(API + '/files/' + encodeURIComponent(stored) + '?fields=id,trashed')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (j) {
        if (j && j.id && !j.trashed) return stored;
        localStorage.removeItem(LS_FILE_ID);
        return search();
      });
  }

  function downloadEnvelope(fileId) {
    return driveFetch(API + '/files/' + encodeURIComponent(fileId) + '?alt=media')
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; });
  }

  // ローカルデータを envelope 形式でアップロードする。成功で true。
  function uploadData() {
    var raw = localStorage.getItem(LS_DATA_KEY);
    if (!raw) return Promise.resolve(false);
    var data;
    try { data = JSON.parse(raw); } catch (e) { return Promise.resolve(false); }

    var updatedAt = new Date().toISOString();
    var body = JSON.stringify({ app: 'kyote', version: 5, updatedAt: updatedAt, data: data });

    return findFileId().then(function (fileId) {
      var req;
      if (fileId) {
        req = driveFetch(UPLOAD_API + '/files/' + encodeURIComponent(fileId) + '?uploadType=media', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: body
        });
      } else {
        var form = new FormData();
        form.append('metadata', new Blob(
          [JSON.stringify({ name: FILE_NAME, mimeType: 'application/json' })],
          { type: 'application/json' }
        ));
        form.append('file', new Blob([body], { type: 'application/json' }));
        req = driveFetch(UPLOAD_API + '/files?uploadType=multipart&fields=id', {
          method: 'POST',
          body: form
        }).then(function (res) {
          if (res.ok) {
            res.clone().json().then(function (j) {
              if (j && j.id) localStorage.setItem(LS_FILE_ID, j.id);
            }).catch(function () {});
          }
          return res;
        });
      }
      return req.then(function (res) {
        if (!res.ok) return false;
        localStorage.setItem(LS_LAST_SYNC, updatedAt);
        // アップロード開始後に新たなローカル変更がなければ変更印を消す
        var localAt = localStorage.getItem(LS_LOCAL_AT);
        if (localAt && localAt <= updatedAt) localStorage.removeItem(LS_LOCAL_AT);
        return true;
      });
    }).catch(function () { return false; });
  }

  // ── Drive → ローカル反映 (app.js のインポート処理と同じ手順) ──
  function applyRemote(env) {
    if (!env || !env.data || !env.data.subjects) return;
    applyingRemote = true;
    try {
      state = env.data;   // app.js のグローバル state を差し替え
      save();             // localStorage へ保存 (kyote:saved は applyingRemote 中は無視される)
      applyTheme();
      buildPanels();
      buildDrawer();
      switchTab('overview');
    } catch (e) { /* 反映に失敗してもアプリは壊さない */ }
    applyingRemote = false;
    localStorage.setItem(LS_LAST_SYNC, env.updatedAt || new Date().toISOString());
    localStorage.removeItem(LS_LOCAL_AT);
  }

  // ── 起動時リコンサイル (last-write-wins) ──
  function reconcileOnStart() {
    if (busy) return Promise.resolve();
    busy = true;
    refreshUI();
    return findFileId()
      .then(function (fileId) {
        if (!fileId) return uploadData();  // Drive にまだ無い → 初回アップロード
        return downloadEnvelope(fileId).then(function (env) {
          if (!env || !env.data) return uploadData();
          var driveAt = env.updatedAt || '';
          var lastSync = localStorage.getItem(LS_LAST_SYNC) || '';
          var localAt = localStorage.getItem(LS_LOCAL_AT) || lastSync;
          if (driveAt > lastSync && driveAt >= localAt) {
            applyRemote(env);               // Drive の方が新しい
            return true;
          }
          if (localAt > driveAt) return uploadData(); // ローカルの方が新しい (オフライン編集など)
          if (driveAt) localStorage.setItem(LS_LAST_SYNC, driveAt);
          return true;
        });
      })
      .catch(function () { return false; })
      .then(function () { busy = false; refreshUI(); });
  }

  // ── 自動アップロード (デバウンス付き) ──
  function autoUpload() {
    if (busy) return;
    if (!tokenValid()) { refreshUI(); return; }  // 未認証セッションでは自動で認証画面を出さない
    getTokenAuto().then(function (ok) {
      if (!ok || busy) return;
      busy = true;
      refreshUI();
      uploadData()
        .catch(function () { return false; })
        .then(function () { busy = false; refreshUI(); });
    });
  }

  document.addEventListener('kyote:saved', function () {
    if (applyingRemote) return;
    localStorage.setItem(LS_LOCAL_AT, new Date().toISOString());
    if (localStorage.getItem(LS_ENABLED) !== '1') return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(autoUpload, DEBOUNCE_MS);
  });

  // 手動同期 (ボタン起点なので、必要なら認証ポップアップが出てよい)
  function syncNow() {
    if (localStorage.getItem(LS_ENABLED) !== '1' || busy) return;
    if (tokenValid()) { reconcileOnStart(); return; }
    setStatus('認証中…');
    var start = function () {
      requestToken(true).then(function (ok) {
        if (ok) reconcileOnStart();
        else { setStatus('認証できませんでした'); }
      });
    };
    if (ensureTokenClient()) start();
    else waitForGis(function (ok) { if (ok) start(); else setStatus('Google に接続できませんでした'); });
  }

  // ── ボタン操作 ──
  function onButtonClick() {
    if (localStorage.getItem(LS_ENABLED) === '1') {
      // 連携解除
      localStorage.removeItem(LS_ENABLED);
      localStorage.removeItem(LS_HINT);
      if (accessToken && window.google && google.accounts && google.accounts.oauth2) {
        try { google.accounts.oauth2.revoke(accessToken, function () {}); } catch (e) {}
      }
      accessToken = null;
      tokenExpiresAt = 0;
      refreshUI();
      return;
    }
    // 連携開始 (ユーザー操作起点なので同意画面が出てよい)
    setStatus('連携中…');
    var start = function () {
      requestToken(true).then(function (ok) {
        if (!ok) { setStatus('連携できませんでした'); return; }
        localStorage.setItem(LS_ENABLED, '1');
        reconcileOnStart();
      });
    };
    if (ensureTokenClient()) start();
    else waitForGis(function (ok) { if (ok) start(); else setStatus('Google に接続できませんでした'); });
  }

  // ── 起動 ──
  refreshUI();
  // 起動時には認証リクエストを送らない (開くたびにアカウント選択が出るのを防ぐ)。
  // 同期は「連携したセッション内での自動アップロード」と「今すぐ同期」ボタンで行う。
})();
