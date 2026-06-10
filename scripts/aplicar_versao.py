# -*- coding: utf-8 -*-
"""
Cache-busting para o GitHub Pages.

Adiciona ?v=<hash> nas referencias de CSS/JS locais e nos dados cifrados
(*_enc.js) dentro dos HTMLs do hub. O hash e do CONTEUDO de cada arquivo:
- muda só quando o arquivo muda -> o navegador re-baixa só o que mudou;
- se nada mudou, o ?v continua igual -> nenhum diff (o .bat segue dizendo
  "sem mudancas").

Versiona: assets/css/*.css, assets/js/*.js, dados/*_enc.js
NAO versiona: assets/vendor/* (libs grandes e estaticas) e imagens.
"""
import re
import hashlib
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
HUB = ROOT / "hub"
HTML_FILES = ["index.html", "performance-mkt.html", "performance-comercial.html"]

# href/src apontando p/ assets/css, assets/js ou dados/, terminando em .css/.js,
# com ?v=... opcional (que sera substituido). Exclui assets/vendor por nao casar o prefixo.
PAT = re.compile(
    r'((?:href|src)\s*=\s*")((?:assets/(?:css|js)|dados)/[^"?]+\.(?:css|js))(\?v=[^"]*)?(")'
)

_cache = {}
def file_hash(relpath):
    if relpath in _cache:
        return _cache[relpath]
    p = HUB / relpath
    v = None
    if p.exists():
        v = hashlib.sha1(p.read_bytes()).hexdigest()[:10]
    _cache[relpath] = v
    return v

def stamp(texto):
    def repl(m):
        pre, path, _old, post = m.group(1), m.group(2), m.group(3), m.group(4)
        v = file_hash(path)
        if not v:
            return m.group(0)  # arquivo nao encontrado -> deixa como esta
        return f"{pre}{path}?v={v}{post}"
    return PAT.sub(repl, texto)

def main():
    total = 0
    for fname in HTML_FILES:
        f = HUB / fname
        if not f.exists():
            continue
        txt = f.read_text(encoding="utf-8")
        novo = stamp(txt)
        if novo != txt:
            f.write_text(novo, encoding="utf-8")
            n = len(PAT.findall(novo))
            print(f"  [OK] {fname}: {n} referencia(s) versionada(s)")
            total += 1
        else:
            print(f"  [-]  {fname}: sem mudanca de versao")
    print(f"  cache-busting aplicado ({total} HTML alterado(s)).")

if __name__ == "__main__":
    main()
