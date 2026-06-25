# -*- coding: utf-8 -*-
"""Glossario UNICO de curso/produto/turma — fonte de verdade compartilhada (comercial + marketing).
Le glossario_global.json e expoe canon_curso/removido/fonte_alias. Mesma logica de
comercial_pipeline.canon_curso (strip turma + normaliza + lookup) — drop-in compativel.
Editar os NOMES no JSON, nunca aqui."""
import json
import re
import unicodedata
from pathlib import Path

_G = json.loads((Path(__file__).parent / "glossario_global.json").read_text(encoding="utf-8"))

# canonico (acentuado, exibicao) -> derivado: chave normalizada -> canonico
CURSO_CANON_DEF = {k: v for k, v in _G["curso_canon"].items()}
_CURSO_CANON = {chave: nome for nome, chaves in CURSO_CANON_DEF.items() for chave in chaves}
FORCA_TOPO = set(_G.get("forca_topo", []))
_REMOVER = set(_G.get("remover", []))
_REMOVER_PREFIXO = tuple(_G.get("remover_prefixo", []))
_FONTE_ALIASES = {k.lower(): v for k, v in _G.get("fonte_aliases", {}).items()}

_TURMA_PREFIXO = re.compile(r"^[Tt]\s*\d+\s*[-–—:]\s*")
_TURMA_SEP = re.compile(r",\s*[Tt]\s*\d+\s*[-–—]\s*")
_TURMA_SUFIXO = re.compile(r"\s*[-–—:]?\s*[Tt]urma\s*\d+.*$")
_FIM_SEP = re.compile(r"[\s\-–—:]+$")


def _strip_turma(s):
    s = _TURMA_SEP.split(str(s).strip())[0].strip()
    s = _TURMA_PREFIXO.sub("", s).strip()
    s = _TURMA_SUFIXO.sub("", s).strip()
    return _FIM_SEP.sub("", s).strip()


def _norm(s):
    s = ''.join(ch for ch in unicodedata.normalize('NFD', str(s).lower()) if unicodedata.category(ch) != 'Mn')
    s = re.sub(r"[^a-z0-9\[\] ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def canon_curso(raw):
    """Normaliza UM rotulo de curso/turma p/ o nome canonico. Sem match -> nome limpo (sem turma)."""
    limpo = _strip_turma(raw)
    if not limpo:
        return ""
    return _CURSO_CANON.get(_norm(limpo), limpo)


def removido(curso):
    """True se o curso e descontinuado/teste (fora de todos os totais)."""
    c = str(curso).strip()
    return c in _REMOVER or any(c.lower().startswith(p) for p in _REMOVER_PREFIXO)


def forca_topo(curso):
    """True se o curso e isca/evento que deve cair no grupo Topo."""
    return str(curso).strip() in FORCA_TOPO


def fonte_alias(fonte):
    """Padroniza a fonte do Investimento p/ o nome do RD (Meta -> Meta Ads, ...)."""
    if fonte is None:
        return "Desconhecido"
    return _FONTE_ALIASES.get(str(fonte).strip().lower(), str(fonte).strip())
