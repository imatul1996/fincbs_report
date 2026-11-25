import frappe
from frappe import _


def execute(filters=None):
	filters = filters or {}
	columns = get_columns()
	data = get_data(filters)
	return columns, data


def get_columns():
	return [
		{
			"label": _("Action"),
			"fieldname": "certificate",
			"fieldtype": "Data",
			"width": 95,
		},
		{
			"label": _("ID"),
			"fieldname": "name",
			"fieldtype": "Data",
			"width": 170,
		},
		{"label": _("Loan Account Number"), "fieldname": "loan_acct_num", "fieldtype": "Data", "width": 150},
		{"label": _("CASA Account Number"), "fieldname": "casa_acct_num", "fieldtype": "Data", "width": 150},
		{"label": _("CASA Scheme Type"), "fieldname": "casa_schm_type", "fieldtype": "Data", "width": 110},
		{"label": _("Account Name"), "fieldname": "acct_name", "fieldtype": "Data", "width": 180},
		{"label": _("Scheme Code"), "fieldname": "schm_code", "fieldtype": "Data", "width": 100},
		{"label": _("Scheme Type"), "fieldname": "schm_type", "fieldtype": "Data", "width": 100},
		{"label": _("Scheme Description"), "fieldname": "schm_desc", "fieldtype": "Data", "width": 180},
		{"label": _("Loan Amount"), "fieldname": "loan_amount", "fieldtype": "Currency", "width": 120},
		{"label": _("SOL ID"), "fieldname": "sol_id", "fieldtype": "Data", "width": 90},
		{"label": _("Account Open Date"), "fieldname": "acct_opn_date", "fieldtype": "Date", "width": 120},
		{"label": _("Account Close Date"), "fieldname": "acct_cls_date", "fieldtype": "Date", "width": 120},
		{"label": _("Repayment Months"), "fieldname": "rep_perd_mths", "fieldtype": "Int", "width": 110},
		{"label": _("Repayment Days"), "fieldname": "rep_perd_days", "fieldtype": "Int", "width": 110},
		{"label": _("Expiry Date"), "fieldname": "expiry_date", "fieldtype": "Date", "width": 110},
		{"label": _("Transaction Amount"), "fieldname": "tran_amt", "fieldtype": "Currency", "width": 130},
		{"label": _("Tran ID"), "fieldname": "tran_id", "fieldtype": "Data", "width": 110},
		{"label": _("Tran Date"), "fieldname": "tran_date", "fieldtype": "Date", "width": 110},
		{"label": _("Refund Status"), "fieldname": "refund_status", "fieldtype": "Data", "width": 110},
		{"label": _("Refund Date"), "fieldname": "refund_date", "fieldtype": "Date", "width": 110},
		{"label": _("Refund Transaction ID"), "fieldname": "refund_transaction_id", "fieldtype": "Data", "width": 150},
		{"label": _("Remarks"), "fieldname": "remarks", "fieldtype": "Small Text", "width": 180},
	]


def get_data(filters):
	conditions = ["sla.parenttype = 'Share Application'", "sla.parentfield = 'loan_accounts'"]
	values = {}

	if filters.get("share_application"):
		conditions.append("sla.parent = %(share_application)s")
		values["share_application"] = filters["share_application"]

	if filters.get("loan_acct_num"):
		conditions.append("sla.loan_acct_num LIKE %(loan_acct_num)s")
		values["loan_acct_num"] = f"%{filters['loan_acct_num'].strip()}%"

	if filters.get("sol_id"):
		conditions.append("sla.sol_id = %(sol_id)s")
		values["sol_id"] = filters["sol_id"].strip()

	if filters.get("refund_status"):
		conditions.append("sla.refund_status = %(refund_status)s")
		values["refund_status"] = filters["refund_status"]

	if filters.get("from_date"):
		conditions.append("sla.acct_opn_date >= %(from_date)s")
		values["from_date"] = filters["from_date"]

	if filters.get("to_date"):
		conditions.append("sla.acct_opn_date <= %(to_date)s")
		values["to_date"] = filters["to_date"]

	where_clause = " AND ".join(conditions)

	return frappe.db.sql(
		f"""
		SELECT
			sla.name,
			sla.parent AS certificate,
			sla.parent,
			sla.loan_acct_num,
			sla.casa_acct_num,
			sla.casa_schm_type,
			sla.acct_name,
			sla.schm_code,
			sla.schm_type,
			sla.schm_desc,
			sla.loan_amount,
			sla.sol_id,
			sla.acct_opn_date,
			sla.acct_cls_date,
			sla.rep_perd_mths,
			sla.rep_perd_days,
			sla.expiry_date,
			sla.tran_amt,
			sla.tran_id,
			sla.tran_date,
			sla.refund_status,
			sla.refund_date,
			sla.refund_transaction_id,
			sla.remarks
		FROM `tabShare Loan Account` sla
		WHERE {where_clause}
		ORDER BY
			sla.acct_cls_date IS NULL ASC,
			sla.acct_cls_date DESC,
			sla.expiry_date IS NULL ASC,
			sla.expiry_date ASC,
			sla.modified DESC
		""",
		values,
		as_dict=True,
	)
