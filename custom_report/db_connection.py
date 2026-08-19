import frappe
import psycopg2
import time
from frappe import _

def get_dr_connection(retries=2, retry_delay=1):
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
        "connect_timeout": 5,
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