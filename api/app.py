import logging
import os
import re
import sqlite3
from datetime import date, datetime, timezone
from flask import Flask, jsonify, request

from deadline_service import calculate_clearance_deadline
from registrar_client import fetch_all_students

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

app = Flask(__name__)
DB_PATH = os.environ.get("HUB_DB_PATH", "clearance_hub.db")

STUDENT_ID_RULE = re.compile(r"^\d{4}-\d{5}$")
ALLOWED_OFFICES = {"Library", "Accounting", "Student Affairs", "Registrar"}
ALLOWED_STATUSES = {"CLEARED", "HOLD"}
ALLOWED_PROGRAMS = {"IT", "IS", "CRIM", "AGRI", "EDMATH"}


def get_db():
    """Open a SQLite connection that returns rows as dictionaries."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create the Hub tables if they do not exist yet."""
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS students (
            student_id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            program_code TEXT NOT NULL,
            program_name TEXT NOT NULL,
            year_level INTEGER NOT NULL,
            email TEXT NOT NULL,
            enrollment_status TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS clearance_records (
            student_id TEXT NOT NULL,
            office TEXT NOT NULL,
            status TEXT NOT NULL,
            reason TEXT DEFAULT '',
            updated_at TEXT NOT NULL,
            PRIMARY KEY (student_id, office),
            FOREIGN KEY (student_id) REFERENCES students(student_id)
        )
    """)
    conn.commit()
    conn.close()


def compute_overall_status(enrollment_status, office_records):
    """Compute overall clearance status, including documented LOA handling."""
    if any(rec["status"] == "HOLD" for rec in office_records):
        return "HOLD"
    if office_records and all(rec["status"] == "CLEARED" for rec in office_records):
        return "CLEARED (LOA)" if enrollment_status == "LOA" else "CLEARED"
    if enrollment_status == "LOA":
        return "LOA (NO ACTIVE HOLDS)"
    return "PENDING"

@app.route("/api/v1/health", methods=["GET"])
def health_check():
    return jsonify({"status": "ok", "service": "DNSC e-Clearance Hub API"}), 200

@app.route("/api/v1/registrar/sync", methods=["POST"])
def sync_registrar():
    try:
        students = fetch_all_students(page_size=10)
    except RuntimeError as err:
        return jsonify({"error": str(err)}), 502

    conn = get_db()
    try:
        for s in students:
            conn.execute("""
                INSERT INTO students
                    (student_id, full_name, program_code, program_name, year_level, email, enrollment_status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(student_id) DO UPDATE SET
                    full_name = excluded.full_name,
                    program_code = excluded.program_code,
                    program_name = excluded.program_name,
                    year_level = excluded.year_level,
                    email = excluded.email,
                    enrollment_status = excluded.enrollment_status
            """, (
                s["student_id"], s["full_name"], s["program_code"],
                s["program_name"], s["year_level"], s["email"], s["enrollment_status"]
            ))
        conn.commit()
    finally:
        conn.close()

    return jsonify({"message": "Registrar masterlist synced", "count": len(students)}), 200

@app.route("/api/v1/students", methods=["GET"])
def list_students():
    program = request.args.get("program", "").strip().upper()
    enrollment = request.args.get("status", "").strip().upper()

    if program and program not in ALLOWED_PROGRAMS:
        return jsonify({"error": f"Invalid program. Allowed: {sorted(ALLOWED_PROGRAMS)}"}), 400
    if enrollment and enrollment not in {"ENROLLED", "LOA"}:
        return jsonify({"error": "Invalid status. Allowed: ENROLLED, LOA"}), 400

    query = "SELECT * FROM students WHERE 1=1"
    params = []
    if program:
        query += " AND program_code = ?"
        params.append(program)
    if enrollment:
        query += " AND enrollment_status = ?"
        params.append(enrollment)
    query += " ORDER BY student_id"

    conn = get_db()
    rows = conn.execute(query, tuple(params)).fetchall()
    conn.close()

    students = [dict(r) for r in rows]
    return jsonify({"count": len(students), "students": students}), 200

@app.route("/api/v1/students/<student_id>/clearance", methods=["GET"])
def get_student_clearance(student_id):
    if not STUDENT_ID_RULE.match(student_id):
        return jsonify({"error": "student_id must match YYYY-NNNNN (e.g., 2023-59928)"}), 400

    conn = get_db()
    student = conn.execute(
        "SELECT * FROM students WHERE student_id = ?", (student_id,)
    ).fetchone()
    if not student:
        conn.close()
        return jsonify({"error": "Student not found"}), 404

    records = conn.execute(
        "SELECT office, status, reason, updated_at FROM clearance_records WHERE student_id = ? ORDER BY office",
        (student_id,),
    ).fetchall()
    conn.close()

    offices = [dict(r) for r in records]
    overall = compute_overall_status(student["enrollment_status"], offices)

    return jsonify({
        "student": dict(student),
        "overall_status": overall,
        "offices": offices,
    }), 200

@app.route("/api/v1/students/<student_id>/clearance", methods=["POST"])
def create_clearance_record(student_id):
    if not STUDENT_ID_RULE.match(student_id):
        return jsonify({"error": "Invalid student_id format"}), 400

    body = request.get_json(silent=True) or {}
    office = str(body.get("office", "")).strip()
    status = str(body.get("status", "")).strip().upper()
    reason = str(body.get("reason", "")).strip()

    if office not in ALLOWED_OFFICES:
        return jsonify({"error": f"Invalid office. Allowed: {sorted(ALLOWED_OFFICES)}"}), 400
    if status not in ALLOWED_STATUSES:
        return jsonify({"error": "status must be CLEARED or HOLD"}), 400
    if status == "HOLD" and not reason:
        return jsonify({"error": "reason is required when placing a HOLD"}), 400

    now = datetime.now(timezone.utc).isoformat()
    conn = get_db()
    try:
        if not conn.execute("SELECT 1 FROM students WHERE student_id = ?", (student_id,)).fetchone():
            return jsonify({"error": "Student not found"}), 404

        conn.execute(
            "INSERT INTO clearance_records (student_id, office, status, reason, updated_at) VALUES (?, ?, ?, ?, ?)",
            (student_id, office, status, reason, now),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        return jsonify({"error": "Clearance record for this office already exists; use PATCH to update"}), 409
    finally:
        conn.close()

    return jsonify({
        "message": "Clearance record created",
        "student_id": student_id,
        "office": office,
        "status": status,
        "reason": reason,
        "updated_at": now,
    }), 201

@app.route("/api/v1/students/<student_id>/clearance/<office>", methods=["PATCH"])
def update_clearance_record(student_id, office):
    if not STUDENT_ID_RULE.match(student_id):
        return jsonify({"error": "Invalid student_id format"}), 400
    if office not in ALLOWED_OFFICES:
        return jsonify({"error": f"Invalid office. Allowed: {sorted(ALLOWED_OFFICES)}"}), 400

    body = request.get_json(silent=True) or {}
    status = str(body.get("status", "")).strip().upper()
    reason = str(body.get("reason", "")).strip()

    if status not in ALLOWED_STATUSES:
        return jsonify({"error": "status must be CLEARED or HOLD"}), 400
    if status == "HOLD" and not reason:
        return jsonify({"error": "reason is required when placing a HOLD"}), 400

    now = datetime.now(timezone.utc).isoformat()
    conn = get_db()
    try:
        if not conn.execute("SELECT 1 FROM students WHERE student_id = ?", (student_id,)).fetchone():
            return jsonify({"error": "Student not found"}), 404

        conn.execute("""
            INSERT INTO clearance_records (student_id, office, status, reason, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(student_id, office) DO UPDATE SET
                status = excluded.status,
                reason = excluded.reason,
                updated_at = excluded.updated_at
        """, (student_id, office, status, reason, now))
        conn.commit()
    finally:
        conn.close()

    return jsonify({
        "message": "Clearance updated",
        "student_id": student_id,
        "office": office,
        "status": status,
        "reason": reason,
        "updated_at": now,
    }), 200

@app.route("/api/v1/offices/<office>/holds", methods=["GET"])
def get_office_holds(office):
    if office not in ALLOWED_OFFICES:
        return jsonify({"error": f"Invalid office. Allowed: {sorted(ALLOWED_OFFICES)}"}), 400

    conn = get_db()
    rows = conn.execute("""
        SELECT s.student_id, s.full_name, s.program_code, c.reason, c.updated_at
        FROM clearance_records c
        JOIN students s ON s.student_id = c.student_id
        WHERE c.office = ? AND c.status = 'HOLD'
        ORDER BY s.student_id
    """, (office,)).fetchall()
    conn.close()

    holds = [dict(r) for r in rows]
    return jsonify({"office": office, "hold_count": len(holds), "students_on_hold": holds}), 200

@app.route("/api/v1/deadline", methods=["GET"])
def get_deadline():
    raw_days = request.args.get("days", "5")
    raw_start = request.args.get("start", "").strip()

    try:
        days = int(raw_days)
        if not 1 <= days <= 60:
            raise ValueError
    except ValueError:
        return jsonify({"error": "days must be an integer between 1 and 60"}), 400

    start_date = None
    if raw_start:
        try:
            start_date = date.fromisoformat(raw_start)
        except ValueError:
            return jsonify({"error": "start must be a valid YYYY-MM-DD date"}), 400

    try:
        result = calculate_clearance_deadline(start_date=start_date, working_days=days)
    except RuntimeError as err:
        return jsonify({"error": str(err)}), 502

    return jsonify(result), 200

@app.route("/api/v1/reports/clearance", methods=["GET"])
def clearance_summary_report():
    conn = get_db()
    students = conn.execute("SELECT * FROM students ORDER BY student_id").fetchall()
    all_records = conn.execute("SELECT student_id, office, status FROM clearance_records").fetchall()
    conn.close()

    by_student = {}
    for rec in all_records:
        by_student.setdefault(rec["student_id"], []).append(dict(rec))

    report = []
    for s in students:
        sid = s["student_id"]
        overall = compute_overall_status(s["enrollment_status"], by_student.get(sid, []))
        report.append({
            "student_id": sid,
            "full_name": s["full_name"],
            "program_code": s["program_code"],
            "enrollment_status": s["enrollment_status"],
            "overall_status": overall,
        })

    return jsonify({"total_students": len(report), "records": report}), 200

@app.errorhandler(500)
def handle_internal_error(err):
    logging.exception("Unexpected server error: %s", err)
    return jsonify({"error": "An internal server error occurred."}), 500


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="127.0.0.1", port=port, debug=False)