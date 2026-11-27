import logging
from datetime import date, timedelta
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

NAGER_BASE_URL = "https://date.nager.at/api/v3/PublicHolidays"


def fetch_ph_holidays(year=2026):
    """Fetch Philippine public holidays for a given year as {YYYY-MM-DD: holiday_name}."""
    url = f"{NAGER_BASE_URL}/{year}/PH"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()

        if not isinstance(data, list):
            raise RuntimeError("Unexpected JSON format from Nager.Date API.")

        holidays = {}
        for item in data:
            holiday_date = item.get("date")
            holiday_name = item.get("localName") or item.get("name", "Public Holiday")
            if holiday_date:
                holidays[holiday_date] = holiday_name
        return holidays

    except requests.exceptions.Timeout:
        logging.error("Nager.Date API timed out.")
        raise RuntimeError("Public holidays service timed out.")
    except requests.exceptions.HTTPError as err:
        logging.error("Nager.Date HTTP error: %s", err)
        raise RuntimeError("Public holidays service returned an HTTP error.")
    except requests.exceptions.RequestException as err:
        logging.error("Network error calling Nager.Date: %s", err)
        raise RuntimeError("Could not reach the public holidays service.")
    except ValueError:
        logging.error("Nager.Date returned invalid JSON.")
        raise RuntimeError("Public holidays service returned bad JSON.")


def calculate_clearance_deadline(start_date=None, working_days=5):
    """Compute a deadline N working days after start_date, skipping weekends and PH holidays."""
    if not isinstance(working_days, int) or not 1 <= working_days <= 60:
        raise ValueError("working_days must be an integer between 1 and 60.")

    current = start_date or date.today()
    holidays = fetch_ph_holidays(current.year)
    loaded_years = {current.year}

    counted = 0
    skipped_holidays = []

    while counted < working_days:
        current += timedelta(days=1)

        if current.year not in loaded_years:
            holidays.update(fetch_ph_holidays(current.year))
            loaded_years.add(current.year)

        if current.weekday() >= 5:
            continue

        iso_day = current.isoformat()
        if iso_day in holidays:
            skipped_holidays.append({"date": iso_day, "name": holidays[iso_day]})
            continue

        counted += 1

    return {
        "start_date": (start_date or date.today()).isoformat(),
        "working_days": working_days,
        "deadline": current.isoformat(),
        "skipped_holidays": skipped_holidays,
    }


if __name__ == "__main__":
    result = calculate_clearance_deadline(date(2026, 11, 25), working_days=5)
    print("Deadline calculation result:")
    print(result)