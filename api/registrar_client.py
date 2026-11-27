import logging
import os
import time
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

REGISTRAR_URL = os.environ.get("REGISTRAR_API_URL", "http://127.0.0.1:8001/api/v1")


def _get_api_key():
    api_key = os.environ.get("REGISTRAR_API_KEY")
    if not api_key:
        raise RuntimeError("REGISTRAR_API_KEY is not set in environment variables.")
    return api_key


def _request_with_retry(url, params=None, max_retries=3):
    headers = {"X-API-Key": _get_api_key()}

    for attempt in range(1, max_retries + 1):
        try:
            response = requests.get(url, headers=headers, params=params, timeout=10)

            if response.status_code == 503:
                wait_seconds = int(response.headers.get("Retry-After", 2))
                logging.warning(
                    "Registrar returned 503 (attempt %d/%d). Waiting %ds...",
                    attempt, max_retries, wait_seconds
                )
                if attempt == max_retries:
                    response.raise_for_status()
                time.sleep(wait_seconds)
                continue

            response.raise_for_status()
            return response.json()

        except requests.exceptions.Timeout:
            logging.error("Registrar API timed out on %s", url)
            raise RuntimeError("Registrar API timed out. Please try again.")
        except requests.exceptions.HTTPError as err:
            status = err.response.status_code if err.response is not None else "unknown"
            logging.error("Registrar HTTP error %s on %s: %s", status, url, err)
            if status == 401:
                raise RuntimeError("Registrar API rejected X-API-Key (401 Unauthorized).")
            if status == 404:
                return None  # Caller decides how to handle missing record
            if status == 400:
                raise RuntimeError("Invalid request parameters sent to Registrar API (400).")
            raise RuntimeError(f"Registrar API returned HTTP error {status}.")
        except requests.exceptions.RequestException as err:
            logging.error("Network error calling Registrar API: %s", err)
            raise RuntimeError("Could not connect to the Registrar API.")
        except ValueError:
            logging.error("Registrar API returned invalid JSON from %s", url)
            raise RuntimeError("Registrar API returned unreadable (bad) JSON.")

    raise RuntimeError("Registrar API failed after maximum retries.")


def map_registrar_student(raw):
    first = raw.get("first_name", "").strip()
    middle = raw.get("middle_initial", "").strip()
    last = raw.get("last_name", "").strip()
    full_name = f"{first} {middle}. {last}" if middle else f"{first} {last}"

    return {
        "student_id": raw.get("student_id", "").strip(),
        "full_name": full_name,
        "program_code": raw.get("program_code", "").strip(),
        "program_name": raw.get("program_name", "").strip(),
        "year_level": int(raw.get("year_level", 0)),
        "email": raw.get("email", "").strip().lower(),
        "enrollment_status": raw.get("status", "ENROLLED").strip().upper(),
    }


def fetch_all_students(page_size=10):
    if not 1 <= page_size <= 20:
        raise ValueError("page_size must be between 1 and 20.")

    all_students = []
    page = 1

    while True:
        payload = _request_with_retry(
            f"{REGISTRAR_URL}/students",
            params={"page": page, "size": page_size},
        )
        if not isinstance(payload, dict) or "data" not in payload:
            raise RuntimeError("Unexpected JSON structure from Registrar API.")

        for raw_student in payload["data"]:
            all_students.append(map_registrar_student(raw_student))

        if not payload.get("has_next", False):
            break
        page += 1

    logging.info("Fetched %d students from Registrar API.", len(all_students))
    return all_students


def fetch_student_by_id(student_id):
    payload = _request_with_retry(f"{REGISTRAR_URL}/students/{student_id}")
    if payload is None:
        return None
    return map_registrar_student(payload)

if __name__ == "__main__":
    students = fetch_all_students(page_size=10)
    print(f"Successfully loaded {len(students)} students.")
    for s in students[:5]:
        print(f"  {s['student_id']} | {s['full_name']} | {s['program_code']} | {s['enrollment_status']}")

    loa_student = fetch_student_by_id("2025-81367")
    print("\nLOA check:", loa_student)
    missing = fetch_student_by_id("2026-00000")
    print("Missing student check (expected None):", missing)