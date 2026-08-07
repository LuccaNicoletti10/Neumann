"""Extract structured candidate records from unstructured text."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List
import json
import re


EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
PHONE_RE = re.compile(
    r"(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,3}\)?[\s.-]?)?\d{4,5}[\s.-]?\d{4}"
)
NAME_LABEL_RE = re.compile(
    r"(?im)^\s*(?:nome|name|contato)\s*[:\-]\s*([^\n,;]+)"
)
ORG_RE = re.compile(
    r"(?im)^\s*(?:empresa|organization|org|companhia|company)\s*[:\-]?\s*([^\n,;]+)"
)
ADDRESS_RE = re.compile(
    r"(?im)^\s*(?:endereço|endereco|address)\s*[:\-]\s*([^\n]+)"
)
# "Falei com Maria Souza" / "Cliente João Pedro Alves pediu"
SPOKE_WITH_RE = re.compile(
    r"(?i)\b(?:falei com|com|cliente|pessoa)\s+"
    r"([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç'''\-]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç'''\-]+){1,3})"
)
# "Ana Clara Mendes (ana@x.com)"
NAME_EMAIL_RE = re.compile(
    r"\b([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç'''\-]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç'''\-]+){1,2})"
    r"\s*\(\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\s*\)"
)
CALL_LINE_RE = re.compile(
    r"(?i)(?:ligação|ligacao|call).*(?:de|from).*(?:para|to).*"
)
DURATION_RE = re.compile(
    r"(?i)(?:duração|duracao|duration)\s*[:\-]?\s*(\d+)\s*(?:s|sec|seg|minutos|mins?)?"
)

BLOCKED_NAME_WORDS = {
    "rua",
    "av",
    "avenida",
    "são",
    "sao",
    "paulo",
    "empresa",
    "company",
    "cliente",
    "contato",
    "email",
    "telefone",
    "phone",
    "endereço",
    "endereco",
    "address",
    "ligação",
    "ligacao",
    "registro",
    "notas",
    "observação",
    "observacao",
    "hoje",
    "amanhã",
    "amanha",
    "neon",
    "tech",
    "acme",
    "globex",
    "latam",
    "brasil",
}


@dataclass
class ExtractionResult:
    """Result of unstructured extraction."""

    people: List[Dict[str, Any]] = field(default_factory=list)
    organizations: List[Dict[str, Any]] = field(default_factory=list)
    phone_calls: List[Dict[str, Any]] = field(default_factory=list)
    raw_snippets: List[str] = field(default_factory=list)

    def to_records(self) -> List[Dict[str, Any]]:
        """Flatten into typed records for the transformation engine."""
        records: List[Dict[str, Any]] = []
        for person in self.people:
            records.append({"_record_type": "Person", **person})
        for org in self.organizations:
            records.append({"_record_type": "Organization", **org})
        for call in self.phone_calls:
            records.append({"_record_type": "PhoneCall", **call})
        return records

    def to_dict(self) -> Dict[str, Any]:
        return {
            "people": self.people,
            "organizations": self.organizations,
            "phone_calls": self.phone_calls,
            "raw_snippets": self.raw_snippets,
            "records": self.to_records(),
        }


def _clean_phone(value: str) -> str:
    return re.sub(r"[^\d+]", "", value)


def _split_name(full_name: str) -> Dict[str, str]:
    full_name = re.sub(r"\s+", " ", full_name).strip(" .,-")
    parts = full_name.split()
    if not parts:
        return {"name": full_name, "firstName": "", "lastName": ""}
    if len(parts) == 1:
        return {"name": full_name, "firstName": parts[0], "lastName": ""}
    return {
        "name": full_name,
        "firstName": parts[0],
        "lastName": " ".join(parts[1:]),
    }


def _is_probable_name(candidate: str) -> bool:
    candidate = re.sub(r"\s+", " ", candidate).strip(" .,-")
    if not candidate or "\n" in candidate:
        return False
    words = candidate.split()
    if len(words) < 2 or len(words) > 4:
        return False
    for word in words:
        if word.lower() in BLOCKED_NAME_WORDS:
            return False
        if not word[:1].isupper():
            return False
        if any(ch.isdigit() for ch in word):
            return False
    # Avoid addresses / orgs that slipped through
    lowered = candidate.lower()
    if any(token in lowered for token in ("rua ", "av.", "avenida", "empresa")):
        return False
    return True


class UnstructuredExtractor:
    """Heuristic extractor: free text → candidate structured records."""

    def extract_text(self, text: str) -> ExtractionResult:
        result = ExtractionResult()
        people_by_key: Dict[str, Dict[str, Any]] = {}
        orgs_by_name: Dict[str, Dict[str, Any]] = {}

        chunks = [c.strip() for c in re.split(r"\n\s*\n+|^\s*-{3,}\s*$", text, flags=re.M) if c.strip()]
        result.raw_snippets = chunks

        for chunk in chunks:
            emails = [e.lower() for e in EMAIL_RE.findall(chunk)]
            phones = [_clean_phone(p) for p in PHONE_RE.findall(chunk)]
            phones = [p for p in phones if len(re.sub(r"\D", "", p)) >= 8]

            address_match = ADDRESS_RE.search(chunk)
            address = address_match.group(1).strip() if address_match else None

            for org_match in ORG_RE.finditer(chunk):
                org_name = org_match.group(1).strip()
                orgs_by_name.setdefault(
                    org_name.lower(),
                    {"name": org_name, "type": "company"},
                )

            names: List[str] = []
            for match in NAME_LABEL_RE.finditer(chunk):
                candidate = match.group(1).strip()
                if _is_probable_name(candidate):
                    names.append(candidate)

            for match in NAME_EMAIL_RE.finditer(chunk):
                candidate = match.group(1).strip()
                email = match.group(2).lower()
                if _is_probable_name(candidate):
                    names.append(candidate)
                    if email not in emails:
                        emails.append(email)

            for match in SPOKE_WITH_RE.finditer(chunk):
                candidate = match.group(1).strip()
                # Trim trailing verbs accidentally captured
                candidate = re.split(
                    r"\s+(?:pediu|hoje|ontem|de|da|do|para|no|na)\b",
                    candidate,
                    maxsplit=1,
                )[0]
                if _is_probable_name(candidate):
                    names.append(candidate)

            # Deduplicate names preserving order
            seen = set()
            unique_names = []
            for name in names:
                key = name.lower()
                if key not in seen:
                    seen.add(key)
                    unique_names.append(name)

            if unique_names:
                for idx, full_name in enumerate(unique_names):
                    person = _split_name(full_name)
                    if idx < len(emails):
                        person["email"] = emails[idx]
                    elif emails:
                        person["email"] = emails[0]
                    if idx < len(phones):
                        person["phone"] = phones[idx]
                    elif phones:
                        person["phone"] = phones[0]
                    if address:
                        person["address"] = address

                    key = person["name"].lower()
                    existing = people_by_key.get(key, {})
                    existing.update({k: v for k, v in person.items() if v})
                    people_by_key[key] = existing
            elif emails:
                for email in emails:
                    key = f"email:{email}"
                    person = {
                        "name": email.split("@")[0].replace(".", " ").title(),
                        "email": email,
                    }
                    if phones:
                        person["phone"] = phones[0]
                    if address:
                        person["address"] = address
                    people_by_key.setdefault(key, person)

            for line in chunk.splitlines():
                if not CALL_LINE_RE.search(line):
                    continue
                line_phones = [_clean_phone(p) for p in PHONE_RE.findall(line)]
                line_phones = [
                    p for p in line_phones if len(re.sub(r"\D", "", p)) >= 8
                ]
                if len(line_phones) < 2:
                    continue
                duration_match = DURATION_RE.search(line)
                result.phone_calls.append(
                    {
                        "caller": line_phones[0],
                        "receiver": line_phones[1],
                        "duration": (
                            int(duration_match.group(1)) if duration_match else None
                        ),
                        "timestamp": None,
                    }
                )

        result.people = list(people_by_key.values())
        result.organizations = list(orgs_by_name.values())
        return result

    def extract_file(self, filepath: str) -> ExtractionResult:
        with open(filepath, "r", encoding="utf-8") as f:
            return self.extract_text(f.read())


def save_extraction(result: ExtractionResult, filepath: str) -> None:
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(result.to_dict(), f, indent=2, ensure_ascii=False)
