import re
from datetime import datetime
from pathlib import Path

import pytest

from app.core.legal import TERMS_VERSION

LEGAL_DIR = Path(__file__).resolve().parents[3] / "frontend" / "content" / "legal"


@pytest.mark.parametrize("document", ["terms.md", "privacy.md"])
def test_terms_version_matches_last_updated_date(document):
    text = (LEGAL_DIR / document).read_text(encoding="utf-8")
    match = re.search(r"\*\*Last updated:\*\* (.+)", text)
    assert match is not None
    last_updated = datetime.strptime(match.group(1).strip(), "%B %d, %Y").date()
    assert last_updated.isoformat() == TERMS_VERSION
