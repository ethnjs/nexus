RESERVED_FIELD_KEYS: dict[str, dict] = {
    "availability": {
        "allowed_question_types": {"shift_select"},
        "write_through_target": "availability",
    },
    "lunch": {
        "allowed_question_types": {"single_select_radio", "single_select_dropdown", "multi_select"},
        "write_through_target": "lunch",
    },
    "event_preference": {
        "allowed_question_types": {"multi_select", "ranked_choice", "single_select_dropdown", "grid"},
        "write_through_target": None,
    },
}