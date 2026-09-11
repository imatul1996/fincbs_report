import frappe
import json
from frappe.boot import load_translations

no_cache = 1


def get_context(context):
	csrf_token = frappe.sessions.get_csrf_token()
	frappe.db.commit()  # nosempgrep
	context.csrf_token = csrf_token
	context.boot = json.dumps(get_boot(), default=str)
	context.site_name = frappe.local.site
	return context


@frappe.whitelist(methods=["POST"], allow_guest=True)
def get_context_for_dev():
	if not frappe.conf.developer_mode:
		frappe.throw(frappe._("This method is only meant for developer mode"))
	return get_boot()


def get_boot():
	bootinfo = frappe._dict(
		{
			"site_name": frappe.local.site,
			"default_route": get_default_route(),
		}
	)

	bootinfo.lang = frappe.local.lang
	load_translations(bootinfo)

	return bootinfo


def get_default_route():
	return "/drishti"


def _map_zone_name(name):
	import re
	match = re.match(r'^Zone\s*-?\s*(.+)', name, re.IGNORECASE)
	if match:
		return 'ZONE-' + match.group(1).strip()
	return name

def _map_region_name(name):
	import re
	match = re.match(r'^Region\s*-?\s*(.+)', name, re.IGNORECASE)
	if match:
		return 'REGION-' + match.group(1).strip()
	return name

@frappe.whitelist(methods=["POST"], allow_guest=True)
def get_report_preference():
	user = frappe.session.user
	if not user or user == "Guest":
		return {"user": user or "Guest", "zone": [], "region": [], "district": [], "sol_id": []}

	pref = frappe.db.get_value(
		"Report Preference",
		{"user": user, "enabled": 1},
		["name"],
	)
	if not pref:
		return {"user": user, "zone": [], "region": [], "district": [], "sol_id": []}

	doc = frappe.get_doc("Report Preference", pref)
	return {
		"user": user,
		"zone": [_map_zone_name(d.zone) for d in doc.get("zone", []) if d.zone],
		"region": [_map_region_name(d.region) for d in doc.get("region", []) if d.region],
		"district": [d.district for d in doc.get("district", []) if d.district],
		"sol_id": [d.sol_id for d in doc.get("sol_id", []) if d.sol_id],
	}


def _employee_status_dict(employee):
	status, resignation_date, relieving_date, sol_id = frappe.db.get_value(
		"Employee", employee, ["status", "resignation_letter_date", "relieving_date", "sol_id"]
	) or ("Active", None, None, None)

	# If employee status is Left, hide BM entirely
	if status == "Left":
		return {"status": "Left", "hide": True}

	_resign = resignation_date and str(resignation_date).strip() not in ("", "None", "0001-01-01")
	_has_relieving = relieving_date and str(relieving_date).strip() not in ("", "None", "0001-01-01")

	relieving_in_days = None
	if _has_relieving:
		relieving_in_days = (frappe.utils.getdate(relieving_date) - frappe.utils.getdate(frappe.utils.today())).days

	# Resign if resignation_letter_date available AND relieving_date NOT available
	# OR if resignation_letter_date NOT available AND relieving_date available AND in future
	final_status = "Active"
	if _resign and not _has_relieving:
		final_status = "Resign"
	elif not _resign and _has_relieving and relieving_in_days is not None and relieving_in_days > 0:
		final_status = "Resign"

	return {
		"status": final_status,
		"sol_id": sol_id or None,
		"resignation_letter_date": str(resignation_date) if resignation_date else None,
		"relieving_date": str(relieving_date) if relieving_date else None,
		"relieving_in_days": relieving_in_days if final_status == "Resign" else None,
	}


@frappe.whitelist(methods=["POST"], allow_guest=True)
def get_current_user_employee_status(employee_id=None):
	# Resolve a specific employee's status when an id is supplied.
	if employee_id:
		employee = None
		if frappe.db.exists("Employee", employee_id):
			employee = employee_id
		else:
			by_number = frappe.db.get_value("Employee", {"employee_number": employee_id}, "name")
			if by_number:
				employee = by_number
			else:
				by_user_id = frappe.db.get_value("Employee", {"user_id": employee_id}, "name")
				if by_user_id:
					employee = by_user_id
				elif "@" not in str(employee_id):
					candidate = f"{employee_id}@sahayog.com"
					if frappe.db.exists("Employee", candidate):
						employee = candidate

		if employee:
			return _employee_status_dict(employee)
		return {"status": "Active", "resignation_letter_date": None, "relieving_date": None, "relieving_in_days": None}

	user = frappe.session.user
	if not user or user == "Guest":
		return {"status": "Active", "resignation_letter_date": None, "relieving_date": None, "relieving_in_days": None}

	employee = frappe.db.get_value("Employee", {"user_id": user}, "name")
	if employee:
		return _employee_status_dict(employee)

	return {"status": "Active", "resignation_letter_date": None, "relieving_date": None, "relieving_in_days": None}


@frappe.whitelist(methods=["POST"], allow_guest=True)
def get_filter_options():
	cache_key = "drishti_filter_options"
	cached = frappe.cache().get_value(cache_key)
	print(f"[Drishti] Cache check: {'HIT' if cached else 'MISS'} (key={cache_key})")
	if cached:
		return cached

	print("[Drishti] Fetching filter options from DB...")
	zones = []
	regions = []
	districts = []
	branches = []
	if frappe.db.exists("DocType", "Sahayog Branch"):
		zones = frappe.get_all("Sahayog Branch", filters={"zone": ["is", "set"]}, fields=["zone"], group_by="zone", order_by="zone asc")
		regions = frappe.get_all("Sahayog Branch", filters={"region": ["is", "set"]}, fields=["region"], group_by="region", order_by="region asc")
		districts = frappe.get_all("Sahayog Branch", filters={"district": ["is", "set"]}, fields=["district"], group_by="district", order_by="district asc")
		branches = frappe.get_all("Sahayog Branch", filters={"branch": ["is", "set"]}, fields=["branch", "name", "sol_id"], order_by="branch asc")
	else:
		zones = frappe.get_all("Zone", fields=["name"], order_by="name asc")
		regions = frappe.get_all("Region", fields=["name"], order_by="name asc")

	result = {
		"zones": [z.zone for z in zones],
		"regions": [r.region for r in regions],
		"districts": [d.district for d in districts],
		"branches": [{"label": f"{b.branch} ({b.name})", "value": b.name} for b in branches],
	}

	frappe.cache().set_value(cache_key, result, expires_in_sec=30)
	print(f"[Drishti] Cached filter options for 30s")
	return result


@frappe.whitelist(methods=["POST"], allow_guest=True)
def get_zone_wise_data(financial_year=None, view="Monthly", target_type="Monthly", filters=None, selected_date=None):
 from custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard import get_sahayog_dashboard
 result = get_sahayog_dashboard(
  financial_year=financial_year,
  view=view,
  target_type=target_type,
  filters=filters,
  selected_date=selected_date,
 )
 return {
  "zone_wise": result.get("zone_wise", []),
  "months": result.get("months", []),
  "permissions": result.get("permissions", {}),
 }


@frappe.whitelist(methods=["POST"], allow_guest=True)
def get_category_wise_data(financial_year=None, view="Monthly", target_type="Monthly", filters=None, selected_date=None):
 from custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard import get_sahayog_dashboard
 result = get_sahayog_dashboard(
  financial_year=financial_year,
  view=view,
  target_type=target_type,
  filters=filters,
  selected_date=selected_date,
 )
 return {
  "category_wise": result.get("category_wise", []),
  "months": result.get("months", []),
 }


@frappe.whitelist(methods=["POST"], allow_guest=True)
def get_product_wise_data(financial_year=None, view="Monthly", target_type="Monthly", filters=None, selected_date=None):
 from custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard import get_sahayog_dashboard
 result = get_sahayog_dashboard(
  financial_year=financial_year,
  view=view,
  target_type=target_type,
  filters=filters,
  selected_date=selected_date,
 )
 return {
  "product_wise": result.get("product_wise", []),
  "all_products": result.get("all_products", []),
 }


@frappe.whitelist(methods=["POST"], allow_guest=True)
def get_agent_wise_data(financial_year=None, view="Monthly", target_type="Monthly", filters=None, selected_date=None):
 import re
 from custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard import get_sahayog_dashboard
 result = get_sahayog_dashboard(
  financial_year=financial_year,
  view=view,
  target_type=target_type,
  filters=filters,
  selected_date=selected_date,
 )
 agent_wise = result.get("agent_wise", [])
 for row in agent_wise:
  z_match = re.match(r'^Zone\s*-?\s*(.+)', row.get("zone", ""), re.IGNORECASE)
  if z_match:
   row["zone"] = "ZONE-" + z_match.group(1).strip()
  r_match = re.match(r'^Region\s*-?\s*(.+)', row.get("region", ""), re.IGNORECASE)
  if r_match:
   row["region"] = "REGION-" + r_match.group(1).strip()
 return {
  "agent_wise": agent_wise,
 }


@frappe.whitelist(methods=["POST"], allow_guest=True)
def get_branch_wise_data(financial_year=None, view="Monthly", target_type="Monthly", filters=None, selected_date=None):
 from custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard import get_sahayog_dashboard
 result = get_sahayog_dashboard(
  financial_year=financial_year,
  view=view,
  target_type=target_type,
  filters=filters,
  selected_date=selected_date,
 )
 return {
  "branch_wise": result.get("branch_wise", []),
  "months": result.get("months", []),
 }


@frappe.whitelist(methods=["POST"], allow_guest=True)
def get_branch_profile(sol_id=None):
 """Fetch branch profile data from Branch Profile Data doctype."""
 if not sol_id:
  frappe.throw("SOL ID is required")
 
 if not frappe.db.exists("DocType", "Branch Profile Data"):
  return {}
 
 result = frappe.get_all(
  "Branch Profile Data",
  filters={"sol_id": sol_id},
  fields=["*"],
  limit_page_length=1
 )
 
 if result:
  doc = result[0]
  if not doc.get("bm_employee_id"):
   from custom_report.branch_v1 import get_bm_details_from_employee
   bm_res = get_bm_details_from_employee(sol_id)
   if bm_res and bm_res.get("data") and len(bm_res["data"]) > 0:
    first_bm = bm_res["data"][0]
    doc["bm_employee_id"] = first_bm.get("name") or first_bm.get("employee_number")
  return doc
 return {}
