# DNSC e-Clearance Hub

IT312 Final Project (Track A): a system that replaces paper clearance at Davao del Norte State College. It pulls records from the Registrar, Library and Accounting systems into one clearance status, so a student can check it from a phone.

## Team

| Member | Role | Main requirements |
|---|---|---|
| Cris Lopez | Project lead / solution architect | R3, R4 |
| Roniel Redulas | API developer | R5, R6, R7 |
| Christel Garganera | Data integration engineer | R1, R2, R9, R10 |
| Lowry Aigrom | Security engineer | R11 to R16 |
| Cris Lopez/Roniel Redulas | Front-end / QA developer | R8, R17 |

## What the Hub does

- Pulls the official student list from the Registrar API (JSON).
- Imports the Library export (XML) and the Accounting export (CSV) into one common clearance schema, and logs every rejected record with a reason.
- Computes each student's status per office (CLEARED or HOLD) and overall.
- Exposes a secured REST API for students, office staff and the Registrar.
- Gives students a web client and a clearance slip with a QR code and short code.
- Sets the clearance deadline using the Nager.Date public holidays API.

## Project structure

```
DNSC-e-Clearance-Hub/
├── frontend/          Web client (index.html, style.css, app.js)
├── backend/           Hub REST API, importers, security (TODO: add)
├── drop_folder/       Office export files and signed manifests (TODO: add)
├── tests/             Test cases and test evidence (TODO: add)
├── .env.example       Environment variable names with placeholder values

└── README.md
```

## Requirements

- Python 3 (TODO: confirm version)
- A modern browser (Chrome, Edge, Brave or Firefox)
- VS Code with the **Live Server** extension (to run the client)
- Internet access for the QR code library and the public holidays API

## Setup

1. Clone the repository:
   ```
   git clone https://github.com/cristillejoylopez/DNSC-e-Clearance-Hub.git
   cd DNSC-e-Clearance-Hub
   ```
2. Switch to the working branch if it has not been merged to `main` yet:
   ```
   git checkout frontend-ui
   ```
3. Create your environment file from the template, then fill in your own values:
   ```
   copy .env.example .env
   ```
   Never commit `.env`. It must stay listed in `.gitignore`.
4. Create a virtual environment and install the backend packages (TODO: backend owner confirms the package list):
   ```
   cd backend
   python -m venv venv
   venv\Scripts\activate
   pip install -r requirements.txt

   ```

## Environment variables

Names only. Real values go in your local `.env` and are never committed. TODO: the security engineer confirms the final list.

| Name | Purpose |
|---|---|
| `SLIP_SECRET` | Signs the clearance slip token (R15) |
| `MANIFEST_HMAC_KEY` | Verifies HMAC-signed import manifests (R14) |
| `REGISTRAR_API_URL` | Base URL of the Registrar API |
| `REGISTRAR_API_KEY` | API key for the Registrar API |
| `DATABASE_FILE` | Path to the SQLite database file |
| `ALLOWED_ORIGINS` | Front-end addresses allowed to call the API (CORS) |

## How to run

### 1. Start the Hub API server

```
cd backend
venv\Scripts\activate
uvicorn main:app --reload --port 8000
```

TODO: replace with the final command if the team uses Flask or a different entry file.
The API runs at `http://localhost:8000`.

### 2. Run the importers

TODO (data integration engineer): add the exact command, for example:


```
python import_all.py
```

The script verifies the signed manifests, imports the Library XML and the Accounting CSV from `drop_folder/`, writes a timestamped log, writes rejected records to the reject log, and moves processed files to `archive/`.

### 3. Open the client

1. Open the project folder in VS Code.
2. Right-click `frontend/index.html` and click **Open with Live Server**.
3. The page opens at `http://127.0.0.1:5500/frontend/index.html`.
4. Log in with a test account created by the backend (TODO: security engineer lists the demo accounts here, and never real passwords).

If the page shows "Cannot reach the server", the API server in step 1 is not running, or `ALLOWED_ORIGINS` does not include your Live Server address.

## Client screens

| Role | What they can do |
|---|---|
| Student | See clearance status per office, the deadline, and the QR clearance slip (shown when fully cleared) |
| Office staff | Sign off (CLEARED) or put a student on HOLD with a reason |
| Admin / Registrar | Load and download clearance reports in JSON, CSV or XML |

The client talks to the Hub only through the REST API. It never reads the database directly (R8).

## API endpoints

The full table (method, path, request and response examples, status codes, required role) is in Appendix E of the final documentation. TODO: the API developer lists the final endpoints here. Endpoints the client currently calls:

| Method | Path | Role |
|---|---|---|
| POST | `/api/auth/login` | Any |

| GET | `/api/clearance/me` | Student |
| POST | `/api/clearance/decision` | Staff |
| GET | `/api/reports/registrar?format=json\|csv\|xml` | Admin |

## Running the tests

TODO (QA): add the commands once the test files exist, for example:

```
cd backend
pytest -v
```

Test cases and results are recorded in Appendix G of the final documentation. The tests cover mapping (XML and CSV), the API, and security (SQL injection, tampered file, wrong role, expired token).

## Security notes

- Passwords are stored as salted hashes. Roles control access to each endpoint.
- All database queries are parameterized.
- Import files must carry a valid HMAC-signed manifest. Tampered or replayed files are rejected.
- Student IDs are masked in public or posted reports.
- Secrets are read from environment variables and are never committed to the repository.

## Data

All data in this project is synthetic. It contains no real student records.

## Emerging technology

QR clearance slip (the slip token is shown as a QR code that any office can verify through the API). TODO: the project lead adds the second technology if the team chooses one.

## Documentation


The final documentation PDF (Chapters 1 to 5 and Appendices A to I) is submitted on the LMS in Week 18.