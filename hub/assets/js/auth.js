/* ============================================================
   HUB AGROADVANCE — Login individual por área (envelope encryption)
   ------------------------------------------------------------
   Cada área é publicada CIFRADA (window.PAINEL_ENC_<AREA>, formato v2):
     { v:2, iter, area, data:{iv,ct}, users:[ {u, salt, iv, wdek} ] }
   - data  = JSON da área cifrado com uma DEK aleatória (AES-256-GCM)
   - users = um "envelope" por pessoa: a DEK embrulhada com a senha dela
   No login: usuário+senha -> acha o envelope (por hash do usuário) ->
   abre a DEK -> descriptografa os dados. Senha nunca está no site.

   Uso:
     const data = await HubAuth.unlock({ key:'mkt', varName:'PAINEL_ENC_MKT', nome:'Performance & Marketing' });
   ============================================================ */
window.HubAuth = (function () {
  const DEK_PREFIX = 'hub_dek_';        // sessionStorage: DEK (base64) por área, escopo da aba
  const REMEMBER_PREFIX = 'hub_cred_';  // localStorage: credenciais (quando "lembrar" marcado)

  // base64 unicode-safe (senhas com acento)
  const enc64 = (s) => btoa(unescape(encodeURIComponent(s)));
  const dec64 = (s) => decodeURIComponent(escape(atob(s)));
  function salvarCred(key, u, p) { try { localStorage.setItem(REMEMBER_PREFIX + key, enc64(JSON.stringify({ u, p }))); } catch (e) {} }
  function lerCred(key) { try { const r = localStorage.getItem(REMEMBER_PREFIX + key); return r ? JSON.parse(dec64(r)) : null; } catch (e) { return null; } }
  function limparCred(key) { try { localStorage.removeItem(REMEMBER_PREFIX + key); } catch (e) {} }

  function b64ToBuf(b64) {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf;
  }
  function bufToB64(buf) {
    let s = '';
    const arr = new Uint8Array(buf);
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return btoa(s);
  }

  async function sha256hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Descriptografa o JSON da área a partir da DEK (bytes)
  async function decryptData(blob, dekBytes) {
    const key = await crypto.subtle.importKey('raw', dekBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBuf(blob.data.iv) }, key, b64ToBuf(blob.data.ct)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // Abre o envelope do usuário com a senha -> retorna a DEK (bytes) ou lança erro
  async function abrirEnvelope(blob, usuario, senha) {
    const uhash = await sha256hex((usuario || '').trim().toLowerCase());
    const env = (blob.users || []).find(e => e.u === uhash);
    if (!env) throw new Error('nao-encontrado');
    const kek = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64ToBuf(env.salt), iterations: blob.iter || 310000, hash: 'SHA-256' },
      await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey']),
      { name: 'AES-GCM', length: 256 }, false, ['decrypt']
    );
    // Se a senha estiver errada, o decrypt abaixo lança (auth tag inválida)
    const dek = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBuf(env.iv) }, kek, b64ToBuf(env.wdek)
    );
    return new Uint8Array(dek);
  }

  function construirOverlay(cfg) {
    const ov = document.createElement('div');
    ov.className = 'hub-login-overlay';
    ov.innerHTML = `
      <div class="hub-login-card">
        <img src="assets/img/LogoAgro.png" alt="Agroadvance" class="hub-login-logo" />
        <div class="hub-login-area">${cfg.nome || 'Área restrita'}</div>
        <h2 class="hub-login-title">Acesso restrito</h2>
        <p class="hub-login-sub">Entre com seu usuário e senha.</p>
        <div class="hub-login-field">
          <input type="text" class="hub-login-user" placeholder="Usuário" autocomplete="username" autocapitalize="none" spellcheck="false" />
        </div>
        <div class="hub-login-field">
          <input type="password" class="hub-login-input" placeholder="Senha" autocomplete="current-password" />
          <button type="button" class="hub-login-eye" aria-label="Mostrar senha">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
        <label class="hub-login-remember-wrap">
          <input type="checkbox" class="hub-login-remember" />
          <span>Lembrar acesso neste computador</span>
        </label>
        <div class="hub-login-err"></div>
        <button type="button" class="hub-login-btn">Entrar</button>
        <a class="hub-login-back" href="index.html">← Voltar ao início</a>
      </div>
    `;
    return ov;
  }

  function unlock(cfg) {
    return new Promise((resolve) => {
      const blob = window[cfg.varName];
      if (!blob || !blob.data || !blob.users) {
        document.body.innerHTML =
          '<div style="font-family:sans-serif;padding:40px;text-align:center;color:#900">' +
          'Dados cifrados desta área não encontrados ou em formato antigo.<br>Rode <b>Atualizar HUB MKT.bat</b>.</div>';
        return;
      }
      if (!window.crypto || !crypto.subtle) {
        document.body.innerHTML =
          '<div style="font-family:sans-serif;padding:40px;text-align:center;color:#900">' +
          'Este navegador/contexto não suporta criptografia segura (Web Crypto).<br>' +
          'Abra pelo site publicado (HTTPS) ou um servidor local.</div>';
        return;
      }

      // 1) Credenciais LEMBRADAS (localStorage) -> auto-login.
      //    Re-deriva a chave da senha, então sobrevive a re-deploys (chave muda a cada update).
      const cred = lerCred(cfg.key);
      if (cred && cred.u && cred.p) {
        abrirEnvelope(blob, cred.u, cred.p)
          .then(dek => decryptData(blob, dek))
          .then(resolve)
          .catch(() => { limparCred(cfg.key); tentarSessao(); });
        return;
      }
      tentarSessao();

      // 2) DEK em cache da SESSÃO (aba) -> entra direto
      function tentarSessao() {
        const dekCache = sessionStorage.getItem(DEK_PREFIX + cfg.key);
        if (dekCache) {
          decryptData(blob, b64ToBuf(dekCache))
            .then(resolve)
            .catch(() => { sessionStorage.removeItem(DEK_PREFIX + cfg.key); pedirLogin(); });
          return;
        }
        pedirLogin();
      }

      function pedirLogin() {
        const ov = construirOverlay(cfg);
        document.body.appendChild(ov);
        document.documentElement.style.overflow = 'hidden';
        const userEl = ov.querySelector('.hub-login-user');
        const passEl = ov.querySelector('.hub-login-input');
        const btn = ov.querySelector('.hub-login-btn');
        const err = ov.querySelector('.hub-login-err');
        const eye = ov.querySelector('.hub-login-eye');
        setTimeout(() => userEl.focus(), 50);

        eye.addEventListener('click', () => {
          passEl.type = passEl.type === 'password' ? 'text' : 'password';
          passEl.focus();
        });

        async function tentar() {
          const usuario = userEl.value, senha = passEl.value;
          if (!usuario || !senha) { (usuario ? passEl : userEl).focus(); return; }
          btn.disabled = true; btn.textContent = 'Verificando…'; err.textContent = '';
          await new Promise(r => setTimeout(r, 20)); // deixa pintar antes do PBKDF2
          try {
            const dek = await abrirEnvelope(blob, usuario, senha);
            const data = await decryptData(blob, dek);
            const lembrar = ov.querySelector('.hub-login-remember') && ov.querySelector('.hub-login-remember').checked;
            if (lembrar) {
              salvarCred(cfg.key, usuario, senha);            // persiste no computador
            } else {
              try { sessionStorage.setItem(DEK_PREFIX + cfg.key, bufToB64(dek)); } catch (e) {}  // só na sessão
            }
            document.documentElement.style.overflow = '';
            ov.remove();
            resolve(data);
          } catch (e) {
            // Mesma mensagem pra usuário inexistente OU senha errada (não revela qual)
            err.textContent = 'Usuário ou senha inválidos.';
            btn.disabled = false; btn.textContent = 'Entrar';
            passEl.value = ''; passEl.focus();
          }
        }
        btn.addEventListener('click', tentar);
        passEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') tentar(); });
        userEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') passEl.focus(); });
      }
    });
  }

  function logout(key) {
    if (key) { sessionStorage.removeItem(DEK_PREFIX + key); limparCred(key); }
    else {
      Object.keys(sessionStorage).filter(k => k.startsWith(DEK_PREFIX)).forEach(k => sessionStorage.removeItem(k));
      Object.keys(localStorage).filter(k => k.startsWith(REMEMBER_PREFIX)).forEach(k => localStorage.removeItem(k));
    }
  }

  return { unlock, logout };
})();
