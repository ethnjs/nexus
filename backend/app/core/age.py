from datetime import date

def calculate_age(birth_date: date, reference_date: date) -> int:
    return reference_date.year - birth_date.year - ((reference_date.month, reference_date.day) < (birth_date.month, birth_date.day))

def meets_age_requirement(birth_date: date, reference_date: date, min_age: int) -> bool:
    return calculate_age(birth_date, reference_date) >= min_age