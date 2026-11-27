from datetime import datetime
import random
from xml.sax.saxutils import escape as xml_escape

import frappe
import psycopg2.extras
import requests
import xmltodict
from frappe import _
from frappe.model.naming import make_autoname
from frappe.utils import nowdate
from requests.exceptions import ConnectionError, HTTPError, ReadTimeout, Timeout

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
	tran_particular = f"Loan Share Refund - {row.loan_acct_num}"[:50]
	return {
		"share_application": share_application,
		"loan_row_name": row.name,
		"loan_acct_num": row.loan_acct_num,
		"acct_name": row.acct_name or "",
		"debit_account": debit_account,
		"credit_account": row.casa_acct_num or "",
		"credit_account_type": row.casa_schm_type or "",
		"debit_tran_particular": tran_particular,
		"credit_tran_particular": tran_particular,
		"amount": float(row.tran_amt or 0),
		"sol_id": sol_id,
		"branch_name": branch_name,
		"refund_status": row.refund_status or "",
	}


def _extract_finacle_error(fixml_root, raw_text):
	body = fixml_root.get("Body", {}) or {}
	error_node = body.get("Error", {}) or {}
	fi_business_exc = error_node.get("FIBusinessException", {}) or {}
	err_detail = fi_business_exc.get("ErrorDetail", {}) or {}
	if isinstance(err_detail, list) and err_detail:
		err_detail = err_detail[0] or {}
	err_desc = err_detail.get("ErrorDesc") or err_detail.get("ErrorCode")
	if err_desc:
		return str(err_desc)
	return raw_text[:500] if raw_text else _("Finacle fund transfer failed.")


@frappe.whitelist()
def execute_loan_refund_transfer(share_application, loan_acct_num):
	"""Execute Finacle XferTrnAdd refund from Loan Share Account GL to customer CASA account."""
	if not frappe.has_permission("Share Application", "write", share_application):
		frappe.throw(_("Not permitted to process refund for Share Application {0}.").format(share_application))

	settings = frappe.get_single("Share Application Settings")
	if not settings.enable_fund_transfer:
		frappe.throw(_("Fund transfer is disabled in Share Application Settings."))

	url = str(settings.finacle_api_url or "").strip()
	if not url:
		frappe.throw(_("Finacle API URL is not configured in Share Application Settings."))

	loan_share_gl = str(settings.loan_share_account_gl or "").strip()
	if not loan_share_gl:
		frappe.throw(_("Loan Share Account GL is not set in Share Application Settings."))

	rows = frappe.db.sql(
		"""
		SELECT name, loan_acct_num, casa_acct_num, tran_amt, sol_id, refund_status
		FROM `tabShare Loan Account`
		WHERE parent = %s
		  AND parenttype = 'Share Application'
		  AND loan_acct_num = %s
		LIMIT 1
		FOR UPDATE
		""",
		(share_application, loan_acct_num),
		as_dict=True,
	)
	if not rows:
		frappe.throw(_("Loan Account {0} not found under Share Application {1}.").format(loan_acct_num, share_application))

	row = rows[0]
	if row.refund_status != "Eligible":
		return {
			"status": "error",
			"message": _("Refund cannot be processed because current status is '{0}'.").format(row.refund_status or "Unknown"),
		}

	amount = float(row.tran_amt or 0)
	if amount <= 0:
		return {"status": "error", "message": _("Transaction amount must be greater than zero.")}

	sol_id = str(row.sol_id or "").strip()
	debit_account = f"{sol_id}{loan_share_gl}"
	credit_account = str(row.casa_acct_num or "").strip()
	if not credit_account:
		return {"status": "error", "message": _("Customer CASA account number is missing.")}

	# Mark In Progress before calling external Finacle API to prevent duplicate transfers
	frappe.db.set_value("Share Loan Account", row.name, "refund_status", "In Progress", update_modified=True)
	frappe.db.commit()

	tran_particular = f"Loan Share Refund - {row.loan_acct_num}"[:50]
	current_date = datetime.now().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]
	guid = random.randint(1000000000, 9999999999)

	xml_parts = (
		f"<PartTrnRec><AcctId><AcctId>{xml_escape(debit_account)}</AcctId></AcctId>"
		f"<CreditDebitFlg>D</CreditDebitFlg>"
		f"<TrnAmt><amountValue>{amount}</amountValue><currencyCode>INR</currencyCode></TrnAmt>"
		f"<TrnParticulars>{xml_escape(tran_particular)}</TrnParticulars>"
		f"<ValueDt>{current_date}</ValueDt></PartTrnRec>"
		f"<PartTrnRec><AcctId><AcctId>{xml_escape(credit_account)}</AcctId></AcctId>"
		f"<CreditDebitFlg>C</CreditDebitFlg>"
		f"<TrnAmt><amountValue>{amount}</amountValue><currencyCode>INR</currencyCode></TrnAmt>"
		f"<TrnParticulars>{xml_escape(tran_particular)}</TrnParticulars>"
		f"<ValueDt>{current_date}</ValueDt></PartTrnRec>"
	)

	xml_data = f"""<?xml version="1.0" encoding="UTF-8"?>
<FIXML xsi:schemaLocation="http://www.finacle.com/fixml XferTrnAdd.xsd" xmlns="http://www.finacle.com/fixml" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <Header>
        <RequestHeader>
            <MessageKey>
                <RequestUUID>{guid}</RequestUUID>
                <ServiceRequestId>XferTrnAdd</ServiceRequestId>
                <ServiceRequestVersion>10.2</ServiceRequestVersion>
                <ChannelId>COR</ChannelId>
            </MessageKey>
            <RequestMessageInfo>
                <BankId>01</BankId>
                <MessageDateTime>{current_date}</MessageDateTime>
            </RequestMessageInfo>
            <Security>
                <Token>
                    <PasswordToken>
                        <UserId></UserId>
                        <Password></Password>
                    </PasswordToken>
                </Token>
            </Security>
        </RequestHeader>
    </Header>
    <Body>
        <XferTrnAddRequest>
            <XferTrnAddRq>
                <XferTrnHdr>
                    <TrnType>T</TrnType>
                    <TrnSubType>CI</TrnSubType>
                </XferTrnHdr>
                <XferTrnDetail>
                    {xml_parts}
                </XferTrnDetail>
            </XferTrnAddRq>
        </XferTrnAddRequest>
    </Body>
</FIXML>"""

	try:
		response = requests.post(
			url,
			data=xml_data.encode("utf-8"),
			headers={"Content-Type": "application/xml"},
			verify=False,
			timeout=(10, 30),
		)
		response.raise_for_status()
	except (Timeout, ReadTimeout):
		msg = _("Finacle API timeout occurred. Transaction status is unknown; verify before retrying.")
		frappe.db.set_value("Share Loan Account", row.name, "remarks", msg, update_modified=True)
		frappe.db.commit()
		return {"status": "error", "message": msg}
	except ConnectionError:
		msg = _("Unable to connect to Finacle API. Please verify network/server availability.")
		frappe.db.set_value(
			"Share Loan Account",
			row.name,
			{"refund_status": "Failed", "remarks": msg},
			update_modified=True,
		)
		frappe.db.commit()
		return {"status": "error", "message": msg}
	except HTTPError as e:
		resp_text = getattr(e.response, "text", "") or str(e)
		msg = f"Finacle HTTP {getattr(e.response, 'status_code', 'error')}: {resp_text[:300]}"
		frappe.db.set_value(
			"Share Loan Account",
			row.name,
			{"refund_status": "Failed", "remarks": msg},
			update_modified=True,
		)
		frappe.db.commit()
		frappe.log_error(resp_text, f"Loan Refund Transfer HTTP Error: {row.name}")
		return {"status": "error", "message": msg}

	response_text = response.text or ""
	try:
		res_dict = xmltodict.parse(response_text)
	except Exception:
		msg = _("Unable to parse Finacle API response.")
		frappe.db.set_value(
			"Share Loan Account",
			row.name,
			{"refund_status": "Failed", "remarks": f"{msg} {response_text[:300]}"},
			update_modified=True,
		)
		frappe.db.commit()
		frappe.log_error(response_text, f"Loan Refund Parse Error: {row.name}")
		return {"status": "error", "message": msg}

	fixml_root = res_dict.get("FIXML", {}) if isinstance(res_dict, dict) else {}
	header = fixml_root.get("Header", {}) or {}
	response_header = header.get("ResponseHeader", {}) or {}
	host_transaction = response_header.get("HostTransaction", {}) or {}
	body = fixml_root.get("Body", {}) or {}
	xfer_response = body.get("XferTrnAddResponse", {}) or {}
	xfer_rs = xfer_response.get("XferTrnAddRs", {}) or {}
	trn_identifier = xfer_rs.get("TrnIdentifier", {}) or {}

	status = (host_transaction.get("Status") or "").strip().upper()
	transaction_id = (trn_identifier.get("TrnId") or "").strip()

	if status == "SUCCESS" and transaction_id:
		frappe.db.set_value(
			"Share Loan Account",
			row.name,
			{
				"refund_status": "Success",
				"refund_transaction_id": transaction_id,
				"refund_date": nowdate(),
				"remarks": tran_particular,
			},
			update_modified=True,
		)
		frappe.db.commit()
		return {
			"status": "success",
			"transaction_id": transaction_id,
			"message": _("Refund completed successfully. Transaction ID: {0}").format(transaction_id),
		}

	err_msg = _extract_finacle_error(fixml_root, response_text)
	frappe.db.set_value(
		"Share Loan Account",
		row.name,
		{"refund_status": "Failed", "remarks": err_msg[:500]},
		update_modified=True,
	)
	frappe.db.commit()
	frappe.log_error(response_text, f"Loan Refund Transfer Failed: {row.name}")
	return {"status": "error", "message": err_msg}


@frappe.whitelist()
def sync_share_loan_accounts_from_report():
	"""Sync latest Finacle loan accounts and closure statuses without altering Success rows."""
	if not frappe.has_permission("Share Application", "write"):
		frappe.throw(_("Not permitted to sync Share Loan Accounts."))

	from banking_api.banking_api.doctype.share_application_settings.share_application_settings import (
		daily_check_loan_accounts_status,
		daily_sync_new_loan_accounts,
	)

	sync_res = daily_sync_new_loan_accounts() or {}
	status_res = daily_check_loan_accounts_status() or {}

	created = sync_res.get("created_count", 0)
	updated = sync_res.get("updated_count", 0)
	status_updated = status_res.get("updated_count", 0)

	return {
		"status": "success",
		"created_count": created,
		"updated_count": updated,
		"status_updated_count": status_updated,
		"message": _(
			"Sync completed. New: {0}, Updated: {1}, Status Checked: {2}"
		).format(created, updated, status_updated),
	}
