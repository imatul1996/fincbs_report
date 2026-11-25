import frappe
import psycopg2.extras
from frappe import _

from frappe.model.naming import make_autoname

from banking_api.banking_api.doctype.share_application_settings.share_application_settings import (
	db_connection,
	sync_share_loan_accounts,
)


def autoname_share_loan_account(doc, method=None):
	"""Name Share Loan Account child rows as {parent}-01, {parent}-02, etc."""
	if doc.parent and not doc.name:
		doc.name = make_autoname(f"{doc.parent}-.##")


def _get_single_cif_priority_query():
	return """
		SELECT
			g.cif_id AS cif_id,
			a.relationshipopeningdate AS cif_opening_date,
			g.foracid AS account_no,
			g.acct_opn_date AS acct_opn_date,
			g.sol_id AS sol_id,
			g.acct_name AS acct_name,
			g.schm_code AS schm_code,
			g.schm_type AS schm_type,
			adr.name AS customer_name,
			concat_ws(', ', adr.address_line1, adr.address_line2) AS address
		FROM tbaadm.gam g
		LEFT JOIN LATERAL (
			SELECT relationshipopeningdate
			FROM crmuser.accounts a
			WHERE a.orgkey = g.cif_id
			  AND a.relationshipopeningdate <= CURRENT_DATE
			ORDER BY a.relationshipopeningdate DESC
			LIMIT 1
		) a ON TRUE
		LEFT JOIN LATERAL (
			SELECT adr.name, adr.address_line1, adr.address_line2
			FROM crmuser.address adr
			WHERE adr.orgkey = g.cif_id
			ORDER BY adr.name NULLS LAST
			LIMIT 1
		) adr ON TRUE
		WHERE CAST(g.cif_id AS TEXT) = %(cif_id)s
		  AND g.schm_code IN (
			'1001','1002','1003','1004','1005','1006','1008','1010',
			'1009','1011','1012','1013','1101','1102','1103','1104',
			'1105','1117'
		  )
		  AND g.entity_cre_flg = 'Y'
		  AND g.del_flg = 'N'
		  AND g.acct_cls_flg = 'N'
		ORDER BY CASE g.schm_code
			WHEN '1001' THEN 1
			WHEN '1002' THEN 2
			WHEN '1003' THEN 3
			WHEN '1004' THEN 4
			WHEN '1005' THEN 5
			WHEN '1006' THEN 6
			WHEN '1008' THEN 7
			WHEN '1010' THEN 8
			WHEN '1009' THEN 9
			WHEN '1011' THEN 10
			WHEN '1012' THEN 11
			WHEN '1013' THEN 12
			WHEN '1101' THEN 13
			WHEN '1102' THEN 14
			WHEN '1103' THEN 15
			WHEN '1104' THEN 16
			WHEN '1105' THEN 17
			WHEN '1117' THEN 18
			ELSE 999
		END,
		g.foracid
		LIMIT 1
	"""


@frappe.whitelist()
def sync_share_application_by_cif(cif_id):
	"""Sync a single CIF into Share Application using priority account query and fetch its loan accounts."""
	if not frappe.conf.developer_mode:
		return {"status": "error", "message": _("This action is only allowed in developer mode.")}

	cif_id = str(cif_id or "").strip()
	if not cif_id:
		return {"status": "error", "message": _("CIF ID is required.")}

	existing = frappe.db.get_value("Share Application", {"cif": cif_id}, "name")
	if existing:
		return {
			"status": "exists",
			"name": existing,
			"message": _("Share Application {0} already exists for CIF {1}.").format(existing, cif_id),
		}

	conn = None
	cursor = None
	try:
		conn = db_connection()
		cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

		cif_query = _get_single_cif_priority_query()
		cursor.execute(cif_query, {"cif_id": cif_id})
		row = cursor.fetchone()

		if not row:
			return {
				"status": "not_found",
				"message": _("No eligible priority account found in Finacle for CIF {0}.").format(cif_id),
			}

		doc = frappe.new_doc("Share Application")
		doc.cif = row.get("cif_id")
		doc.account_number = row.get("account_no")
		doc.sol_id = row.get("sol_id")
		doc.cif_creation_date = row.get("cif_opening_date")
		doc.status = "Pending"
		doc.customer_name = row.get("customer_name") or row.get("acct_name") or ""
		doc.address = row.get("address") or ""
		doc.scheme_code = row.get("schm_code") or ""
		doc.scheme_type = row.get("schm_type") or ""
		doc.account_opening_date = row.get("acct_opn_date")
		doc.insert(ignore_permissions=True)
		frappe.db.commit()

		loan_created = 0
		try:
			loan_res = sync_share_loan_accounts(cif_id=cif_id) or {}
			loan_created = loan_res.get("created_count", 0)
		except Exception:
			frappe.log_error(frappe.get_traceback(), f"Loan sync failed for CIF {cif_id}")

		return {
			"status": "success",
			"name": doc.name,
			"loan_created": loan_created,
			"message": _("Share Application {0} created for CIF {1} (Account: {2}, Loans synced: {3}).").format(
				doc.name, cif_id, doc.account_number, loan_created
			),
		}
	except Exception as e:
		frappe.db.rollback()
		frappe.log_error(frappe.get_traceback(), f"Sync by CIF failed for {cif_id}")
		return {"status": "error", "message": str(e)}
	finally:
		if cursor:
			cursor.close()
		if conn:
			conn.close()


@frappe.whitelist()
def get_loan_refund_preview(share_application, loan_acct_num):
	"""Return Debit & Credit preview details for a Share Loan Account refund."""
	row = frappe.db.get_value(
		"Share Loan Account",
		{
			"parent": share_application,
			"parenttype": "Share Application",
			"loan_acct_num": loan_acct_num,
		},
		[
			"name",
			"loan_acct_num",
			"casa_acct_num",
			"casa_schm_type",
			"acct_name",
			"tran_amt",
			"sol_id",
			"refund_status",
		],
		as_dict=True,
	)
	if not row:
		frappe.throw(_("Loan Account {0} not found under Share Application {1}.").format(loan_acct_num, share_application))

	loan_share_gl = str(frappe.db.get_single_value("Share Application Settings", "loan_share_account_gl") or "").strip()
	sol_id = str(row.sol_id or "").strip()
	debit_account = f"{sol_id}{loan_share_gl}" if loan_share_gl else ""
	branch_name = (
		frappe.db.get_value("Share Application", share_application, "branch")
		or frappe.db.get_value("Sahayog Branch", sol_id, "branch")
		or ""
	)
	return {
		"share_application": share_application,
		"loan_row_name": row.name,
		"loan_acct_num": row.loan_acct_num,
		"acct_name": row.acct_name or "",
		"debit_account": debit_account,
		"credit_account": row.casa_acct_num or "",
		"credit_account_type": row.casa_schm_type or "",
		"amount": float(row.tran_amt or 0),
		"sol_id": sol_id,
		"branch_name": branch_name,
		"refund_status": row.refund_status or "",
	}
