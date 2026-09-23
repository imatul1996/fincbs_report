import frappe
import psycopg2
import time
from frappe import _

def get_dr_connection(retries=3, retry_delay=2, timeout=15):
    """
    Establishes a connection to the Disaster Recovery (DR) / External Finacle DB 
    using credentials from the 'Finacle DB Credentials' Single Doctype.
    Retries up to `retries` times on connection failure.
    """
    last_error = None
    config = frappe.get_single("Finacle DB Credentials")

    if not config.db_host or not config.db_name or not config.db_user:
        frappe.throw(_("DR Database configuration is incomplete. Please check 'Finacle DB Credentials'."))

    connection_params = {
        "host": config.db_host,
        "port": config.db_port or 5432,
        "database": config.db_name,
        "user": config.db_user,
        "password": config.get_password("db_password"),
        "connect_timeout": timeout or 15,
    }

    for attempt in range(retries):
        try:
            return psycopg2.connect(**connection_params)
        except psycopg2.Error as e:
            last_error = e
            frappe.log_error(
                message=f"DR DB Connection Attempt {attempt + 1}/{retries}: {str(e)}",
                title="DR DB Connection Error",
            )
            if attempt < retries - 1:
                time.sleep(retry_delay)

    frappe.throw(
        _("Unable to connect to the DR Database after {0} attempts. Last error: {1}").format(
            retries, str(last_error)
        )
    )

def execute_dr_query(query, params=None, cursor_factory=None, max_retries=5, title="DR DB Query", return_columns=False):
    """
    Executes a query on the DR PostgreSQL database with automatic retries on
    connection drops or standby recovery conflicts (40001, 55006, etc.).
    Returns fetched rows, or (columns, rows) when return_columns=True.
    """
    for attempt in range(max_retries):
        conn = None
        try:
            conn = get_dr_connection()
            with conn.cursor(cursor_factory=cursor_factory) as cur:
                try:
                    cur.execute("SET statement_timeout = 0;")
                except Exception:
                    pass
                if params:
                    cur.execute(query, params)
                else:
                    cur.execute(query)
                rows = cur.fetchall()
                columns = [desc[0] for desc in cur.description] if (return_columns and cur.description) else None
            if return_columns:
                return columns, rows
            return rows
        except Exception as e:
            err_str = str(e).lower()
            is_recovery_conflict = any(term in err_str for term in [
                "conflict with recovery", "canceling statement", "querycanceled",
                "serializationfailure", "55006", "40001"
            ])
            if is_recovery_conflict and attempt < max_retries - 1:
                retry_delay = (attempt + 1) * 3
                frappe.log_error(
                    message=f"{title} Conflict (Attempt {attempt + 1}/{max_retries}). Retrying in {retry_delay}s... Error: {e}",
                    title=f"{title} Execution Failed"
                )
                time.sleep(retry_delay)
            else:
                frappe.log_error(message=frappe.get_traceback(), title=f"{title} Execution Failed")
                raise e
        finally:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass
    if return_columns:
        return [], []
    return []