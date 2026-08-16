from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from app.models.models import FormAnswer, FormField, TournamentEvent

import re # Regular Expressions for searching, matching, and extracting patterns in text strings

def remove_form_field(
        db: Session,
        field: FormField
) -> bool:
    
    has_answers = db.query(FormAnswer).filter(FormAnswer.field_id == field.id).first() is not None

    if has_answers:
        field.is_archived = True
        db.commit()
        return True
    else:
        db.delete(field)
        db.commit()
        return False

def update_field_text(
        db: Session,
        field: FormField,
        label: str | None,
        description: str | None
) -> FormField:

    if label is not None:
        field.label = label
    if description is not None:
        field.description = description

    db.commit()
    db.refresh(field)
    return field

def replace_field_type(
        db: Session,
        field: FormField,
        new_type: str
) -> FormField:
    
    field.is_archived = True

    old_key = field.field_key
    field.field_key = f"{old_key}_archived_{field.id}"

    new_field = FormField(
        form_id=field.form_id,
        order=field.order,
        label=field.label,
        description=field.description,
        question_type=new_type,
        field_key=old_key,
        required=field.required,
        is_archived=False,
    )

    db.add(new_field)
    db.commit()
    db.refresh(new_field)
    return new_field

def add_option(
        db: Session,
        field: FormField,
        label: str | None = None,
) -> FormField:

    config = dict(field.config or {})
    options = config.get("options", [])

    max_id = 0
    for option in options:
        match = re.search(r"^opt_(\d+)$", option.get("id", ""))
        if match:
            num = int(match.group(1))
            if num > max_id:
                max_id = num

    new_option = {
        "id": f"opt_{max_id + 1}",
        "label": label,
        "archived": False,
        "next_section_id": None,
        "allow_other": False
    }

    options.append(new_option)
    config["options"] = options

    field.config = config
    flag_modified(field, "config")

    db.commit()
    db.refresh(field)

    return field


def change_option_label(
        db: Session,
        field: FormField,
        option_id: str,
        label: str,
) -> FormField:
    
    config = dict(field.config or {})
    options = config.get("options", [])

    for option in options:
        if option.get("id") == option_id:
            option["label"] = label
            break

    field.config = config
    flag_modified(field, "config")

    db.commit()
    db.refresh(field)
    return field

def remove_option_from_field(
        db: Session,
        field: FormField,
        option_id: str,
) -> FormField:
    config = dict(field.config or {})
    options = config.get("options", [])

    for option in options:
        if option.get("id") == option_id:
            option["archived"] = True
            break

    field.config = config
    flag_modified(field, "config")

    db.commit()
    db.refresh(field)
    return field

def resolve_field_options(db: Session, field: FormField) -> list[dict]:
    """
    Resolves option items for a given FormField.
    If the field depends on live DB data (e.g. event_preference), queries the database.
    Otherwise, returns options stored in field.config.
    """
    # 1. Dynamic lookup: Tournament Event Preferences
    if field.field_key == "event_preference":
        if field.form and field.form.tournament_id:
            events = (
                db.query(TournamentEvent)
                .filter(TournamentEvent.tournament_id == field.form.tournament_id)
                .order_by(TournamentEvent.id.asc())
                .all()
            )
            return [
                {
                    "id": f"opt_{event.id}",
                    "label": event.name,
                    "archived": False,
                    "next_section_id": None,
                    "allow_other": False,
                }
                for event in events
            ]
        return []

    # 2. Stubbed dynamic lookup: Availability & Lunch
    elif field.field_key in ("availability", "lunch"):
        # TODO(temp): wire up in Step 7
        return []

    # 3. Static fallback: Read options list directly from config
    config = dict(field.config or {})
    return config.get("options", [])