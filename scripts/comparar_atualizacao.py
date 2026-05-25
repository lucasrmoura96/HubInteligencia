"""
Compara o JSON recem-gerado com a versao do ultimo commit (git HEAD)
e mostra delta minimalista: leads, mqls, vendas, custo.

Esta logica nao depende de snapshot local — usa o git history.
Se for o primeiro commit, exibe baseline.
"""
import json
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
ATUAL = BASE / "hub" / "dados" / "performance_mkt.json"

GIT_PATH = "hub/dados/performance_mkt.json"


def totais(d: dict) -> dict:
    """Extrai os 4 numeros que importam pro acompanhamento diario."""
    fundo_k = d.get("fundo", {}).get("kpis", {})
    topo_k = d.get("topo", {}).get("kpis", {})
    atrib_cob = d.get("atribuicao", {}).get("cobertura", {})
    return {
        "leads":  int(fundo_k.get("leads", 0)) + int(topo_k.get("leads", 0)),
        "mqls":   int(fundo_k.get("mqls",  0)) + int(topo_k.get("mqls",  0)),
        "ganhos": int(atrib_cob.get("ganhos_total", 0)),
        "custo":  float(fundo_k.get("custo", 0)) + float(topo_k.get("custo", 0)),
    }


def fmt_int(v: int) -> str:
    sinal = "+" if v >= 0 else ""
    return f"{sinal}{v:,}".replace(",", ".")


def fmt_real(v: float) -> str:
    sinal = "+" if v >= 0 else "-"
    return f"{sinal}R$ {abs(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def main():
    if not ATUAL.exists():
        print("        (JSON atual nao encontrado — pipeline rodou?)")
        return 0

    atual = totais(json.loads(ATUAL.read_text(encoding="utf-8")))

    # Tenta ler versao anterior do git HEAD
    try:
        result = subprocess.run(
            ["git", "show", f"HEAD:{GIT_PATH}"],
            cwd=BASE, capture_output=True, text=True, encoding="utf-8",
            timeout=10,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr)
        ant = totais(json.loads(result.stdout))
    except Exception:
        # Primeiro commit ou git indisponivel — mostra so o baseline atual
        print("        Linha base (primeiro deploy):")
        print(f"          Leads     {atual['leads']:>10,}".replace(",", "."))
        print(f"          MQLs      {atual['mqls']:>10,}".replace(",", "."))
        print(f"          Vendas    {atual['ganhos']:>10,}".replace(",", "."))
        cs = f"R$ {atual['custo']:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        print(f"          Custo     {cs:>10}")
        return 0

    delta = {k: atual[k] - ant.get(k, 0) for k in atual}

    if all(v == 0 for v in delta.values()):
        print("        Nenhuma mudanca desde o ultimo deploy.")
        return 0

    print("        Leads     " + fmt_int(delta["leads"]).rjust(10))
    print("        MQLs      " + fmt_int(delta["mqls"]).rjust(10))
    print("        Vendas    " + fmt_int(delta["ganhos"]).rjust(10))
    print("        Custo     " + fmt_real(delta["custo"]).rjust(15))
    return 0


if __name__ == "__main__":
    sys.exit(main())
