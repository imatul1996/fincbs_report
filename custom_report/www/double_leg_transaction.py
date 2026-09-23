import frappe
import csv
import io
from datetime import date, datetime
from decimal import Decimal


def _has_access():
	user = frappe.session.user
	if user == "Administrator":
		return True
	return frappe.db.exists("Has Role", {"parent": user, "role": "Double Transaction Utility Tool"})


def get_context(context):
	if not _has_access():
		context.show_form = False
	else:
		context.show_form = True
	# Hide DB status when not admin, or when admin is impersonating another user
	impersonated_by = frappe.session.data.get("impersonated_by") if frappe.session else None
	context.is_admin = frappe.session.user == "Administrator" and not impersonated_by


@frappe.whitelist(allow_guest=True)
def check_db_connectivity():
	"""Check DR database connectivity status."""
	if not _has_access():
		frappe.throw("Access Denied", frappe.PermissionError)
	from custom_report.db_connection import get_dr_connection
	import time

	impersonated_by = frappe.session.data.get("impersonated_by") if frappe.session else None
	is_admin = frappe.session.user == "Administrator" and not impersonated_by
	if not is_admin:
		frappe.throw("Access Denied", frappe.PermissionError)

	try:
		start = time.time()
		conn = get_dr_connection()
		elapsed = round((time.time() - start) * 1000)
		with conn.cursor() as cur:
			cur.execute("SELECT version()")
			db_version = cur.fetchone()[0]
			cur.execute("SELECT NOW()")
			db_time = cur.fetchone()[0]
		conn.close()
		return {
			"status": "connected",
			"message": "DR Database connected successfully",
			"latency_ms": elapsed,
			"db_version": db_version,
			"db_time": str(db_time),
		}
	except Exception as e:
		return {
			"status": "failed",
			"message": str(e),
		}


def _build_csv(rows, columns=None, include_header=True):
	buf = io.StringIO()
	writer = csv.writer(buf, lineterminator="\r\n")

	if include_header and columns:
		writer.writerow([str(c).upper() for c in columns])

	for row in rows:
		cleaned = []
		for val in row:
			if val is None:
				cleaned.append("")
			elif isinstance(val, Decimal):
				cleaned.append(format(val, "f"))
			elif isinstance(val, (date, datetime)):
				cleaned.append(val.isoformat())
			else:
				cleaned.append(str(val))
		writer.writerow(cleaned)

	csv_content = buf.getvalue()
	buf.close()
	return csv_content


@frappe.whitelist(allow_guest=True)
def download_transactions():
	"""API endpoint for batch CSV download of transactions."""
	if not _has_access():
		frappe.throw("Access Denied", frappe.PermissionError)
	from custom_report.db_connection import execute_dr_query

	account_value = frappe.form_dict.get("account_value", "").strip()
	start_date = frappe.form_dict.get("start_date")
	end_date = frappe.form_dict.get("end_date")
	offset = int(frappe.form_dict.get("offset", 0))
	limit = int(frappe.form_dict.get("limit", 50000))

	if not account_value:
		frappe.throw("Enter the account value.")

	core_sql = """
		SELECT
			g.cif_id,
			g.foracid,
			g.bacid,
			g.acct_name,
			g.acct_opn_date,
			g.acct_cls_date,
			g.sol_id,
			g.schm_code,
			g.schm_type,
			g.gl_sub_head_code,
			g.clr_bal_amt,
			h.*
		FROM tbaadm.gam g
		INNER JOIN tbaadm.htd h
			ON g.acid = h.acid
		   AND h.pstd_flg = 'Y'
		INNER JOIN (
			SELECT DISTINCT
				h.tran_id,
				h.tran_date
			FROM tbaadm.htd h
			INNER JOIN tbaadm.gam g
				ON h.acid = g.acid
			   AND h.pstd_flg = 'Y'
			WHERE (
					g.bacid = %(account_value)s
				 OR g.foracid = %(account_value)s
				 OR g.gl_sub_head_code = %(account_value)s
				  )
			  AND h.tran_date BETWEEN %(start_date)s AND %(end_date)s
		) v
			ON h.tran_id = v.tran_id
		   AND h.tran_date = v.tran_date
		ORDER BY
			h.tran_date,
			h.tran_id
	"""

	params = {
		"account_value": account_value,
		"start_date": start_date,
		"end_date": end_date,
		"limit": limit,
		"offset": offset,
	}

	try:
		count_rows = execute_dr_query(
			"SELECT COUNT(*) FROM (" + core_sql.rstrip().rstrip(";") + ") AS report_rows",
			params,
		)
		total = count_rows[0][0] if count_rows else 0
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Transaction Count Error")
		frappe.throw("The report could not be generated. Try again in a moment.")

	if total == 0:
		frappe.throw("No posted transactions found for this account and date range.")

	data_sql = core_sql + "\nLIMIT %(limit)s OFFSET %(offset)s"
	try:
		columns, rows = execute_dr_query(data_sql, params, return_columns=True)
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Transaction Data Error")
		frappe.throw("The report could not be generated. Try again in a moment.")

	csv_content = _build_csv(rows, columns=columns, include_header=(offset == 0))

	frappe.local.response["message"] = {
		"total": total,
		"batch_rows": len(rows),
		"csv": csv_content,
	}
