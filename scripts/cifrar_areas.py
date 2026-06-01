"""
Cifra os dados de cada ÁREA com LOGIN INDIVIDUAL (envelope encryption, AES-256-GCM).

Modelo:
- Cada ÁREA tem uma chave de dados aleatória (DEK) que cifra o JSON.
- Para cada USUÁRIO autorizado àquela área, a DEK é "embrulhada" (cifrada) com uma
  chave derivada da senha dele (PBKDF2). Isso vira um "envelope".
- O arquivo publicado contém: o dado cifrado (com a DEK) + a lista de envelopes.
- No navegador: usuário+senha -> acha o envelope -> abre a DEK -> descriptografa o dado.

Segurança:
- A senha NUNCA é publicada (só um envelope derivado dela).
- O nome de usuário é publicado HASHEADO (SHA-256) -> não expõe a lista de pessoas.
- Cada build gera DEK nova -> acessos/caches antigos deixam de funcionar (revogação efetiva).

Entrada:  ../usuarios.local.json  (gitignored)
Saída:    hub/dados/<area>_enc.js  ->  window.PAINEL_ENC_<AREA> = {...}

Uso: python scripts/cifrar_areas.py
"""
from pathlib import Path
import json
import os
import base64
import hashlib
import sys

try:
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:
    print("[X] Falta a lib 'cryptography'. Instale com:  pip install cryptography")
    sys.exit(1)

RAIZ = Path(__file__).parent.parent
DADOS = RAIZ / "hub" / "dados"
USUARIOS = RAIZ / "usuarios.local.json"

ITERACOES = 310_000  # PBKDF2 (alinhar com o JS)

# ============================================================
# Mapa de ÁREAS: chave -> (json_plaintext, saida_enc_js, var_global)
# Adicionar área nova = uma linha aqui + usuários com essa área no usuarios.local.json
# ============================================================
AREAS = {
    "mkt": {
        "fonte": DADOS / "performance_mkt.json",
        "saida": DADOS / "performance_mkt_enc.js",
        "var": "PAINEL_ENC_MKT",
    },
    "comercial": {
        "fonte": DADOS / "performance_comercial.json",
        "saida": DADOS / "performance_comercial_enc.js",
        "var": "PAINEL_ENC_COMERCIAL",
    },
}


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def hash_usuario(usuario: str) -> str:
    norm = usuario.strip().lower()
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()


def deriva_kek(senha: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERACOES)
    return kdf.derive(senha.encode("utf-8"))


def cifra_area(texto: bytes, usuarios_da_area: list) -> dict:
    """usuarios_da_area = [{usuario, senha}]. Retorna o blob v2."""
    dek = os.urandom(32)
    iv_data = os.urandom(12)
    data_ct = AESGCM(dek).encrypt(iv_data, texto, None)  # ct + tag

    envelopes = []
    for u in usuarios_da_area:
        salt = os.urandom(16)
        iv_u = os.urandom(12)
        kek = deriva_kek(u["senha"], salt)
        wdek = AESGCM(kek).encrypt(iv_u, dek, None)  # DEK embrulhada
        envelopes.append({
            "u": hash_usuario(u["usuario"]),
            "salt": b64(salt),
            "iv": b64(iv_u),
            "wdek": b64(wdek),
        })

    return {
        "v": 2,
        "iter": ITERACOES,
        "data": {"iv": b64(iv_data), "ct": b64(data_ct)},
        "users": envelopes,
    }


def main():
    if not USUARIOS.exists():
        print(f"[X] {USUARIOS.name} não encontrado.")
        print("    Copie usuarios.local.example.json para usuarios.local.json e defina os usuários.")
        sys.exit(1)

    cfg_users = json.loads(USUARIOS.read_text(encoding="utf-8"))
    todos = cfg_users.get("usuarios", [])

    # Valida usuários
    validos = []
    for u in todos:
        usuario = (u.get("usuario") or "").strip()
        senha = u.get("senha") or ""
        areas = u.get("areas") or []
        if not usuario or not senha or str(senha).startswith("defina"):
            print(f"[!] Usuário '{usuario or '(vazio)'}' ignorado (sem senha válida).")
            continue
        validos.append({"usuario": usuario, "senha": senha, "areas": areas})

    if not validos:
        print("[X] Nenhum usuário válido em usuarios.local.json.")
        sys.exit(1)

    feitas = 0
    for area, cfg in AREAS.items():
        usuarios_area = [{"usuario": u["usuario"], "senha": u["senha"]}
                         for u in validos if area in u["areas"]]
        if not usuarios_area:
            print(f"[!] Área '{area}': nenhum usuário autorizado. Pulando.")
            continue
        fonte = cfg["fonte"]
        if not fonte.exists():
            print(f"[!] Área '{area}': fonte {fonte.name} não existe. Pulando.")
            continue

        texto = fonte.read_bytes()
        blob = cifra_area(texto, usuarios_area)
        blob["area"] = area

        js = f"window.{cfg['var']} = {json.dumps(blob, ensure_ascii=False)};\n"
        cfg["saida"].write_text(js, encoding="utf-8")

        nomes = ", ".join(u["usuario"] for u in usuarios_area)
        tam_out = cfg["saida"].stat().st_size / 1024
        print(f"[OK] {area}: {len(usuarios_area)} usuário(s) [{nomes}] -> {cfg['saida'].name} ({tam_out:.0f} KB)")
        feitas += 1

    if feitas == 0:
        print("[X] Nenhuma área cifrada. Confira usuarios.local.json e os JSON de origem.")
        sys.exit(1)
    print(f"\n[OK] {feitas} área(s) cifrada(s). Só o(s) _enc.js vai(vão) pro deploy.")


if __name__ == "__main__":
    main()
