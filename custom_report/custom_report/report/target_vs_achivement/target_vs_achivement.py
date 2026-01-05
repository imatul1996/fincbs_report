import frappe
from frappe.utils import getdate, add_months, add_years


# =========================================================
# EXECUTE
# =========================================================
def execute(filters=None):
    filters = filters or {}
    
    # Validate required filters
    if not filters.get("date"):
        frappe.throw("Please select a date")
    
    if not filters.get("type"):
        filters["type"] = "Monthly"

    columns = get_columns()
    current_rows = get_current_data(filters)
    previous_map = get_previous_achievement_map(filters)

    data = build_final_data(current_rows, previous_map, filters, keep_category=True)

    prev_category_map = get_previous_category_map(filters)
    report_summary = get_report_summary(data, prev_category_map)

    for row in data:
        row.pop("_cat", None)

    return columns, data, None, None, report_summary


# =========================================================
# HELPERS
# =========================================================
def normalize_target_type(target_type):
    return "YTD" if target_type == "Quarterly" else target_type


def format_number(value):
    try:
        return "{:,.2f}".format(float(value))
    except Exception:
        return value


def format_date_ddmmyy(value):
    try:
        return getdate(value).strftime("%d-%m-%y")
    except Exception:
        return value


# =========================================================
# COLUMNS
# =========================================================
def get_columns():
    return [
        {"label": "SOL ID", "fieldname": "sol_id", "fieldtype": "HTML", "width": 90},
        {"label": "Branch", "fieldname": "branch", "fieldtype": "HTML", "width": 180},
        {"label": "Achievement", "fieldname": "achievement", "fieldtype": "HTML", "width": 120},
        {"label": "Target", "fieldname": "target", "fieldtype": "HTML", "width": 120},
        {"label": "Achievement %", "fieldname": "achievement_percent", "fieldtype": "HTML", "width": 120},
        {"label": "Compare %", "fieldname": "compare_percent", "fieldtype": "HTML", "width": 120},
        {"label": "Performance Category", "fieldname": "performance_category", "fieldtype": "HTML", "width": 160},
        {"label": "Date", "fieldname": "date", "fieldtype": "HTML", "width": 100},
        {"label": "Achievement Band", "fieldname": "achievement_band", "fieldtype": "HTML", "width": 140},
        {"label": "Zone", "fieldname": "zone", "fieldtype": "HTML", "width": 120},
        {"label": "Region", "fieldname": "region", "fieldtype": "HTML", "width": 120},
        {"label": "District", "fieldname": "district", "fieldtype": "HTML", "width": 120},
        {"label": "Branch Category", "fieldname": "branch_category", "fieldtype": "HTML", "width": 140},
    ]


# =========================================================
# PREVIOUS DATE LOGIC
# =========================================================
def get_previous_date(base_date, compare_type, filters):
    base_date = getdate(base_date)

    if compare_type == "Daily":
        target_date = base_date
        condition = "date < %(target_date)s"

    elif compare_type == "Monthly":
        target_date = add_months(base_date, -1)
        condition = """
            DAY(date) = DAY(%(target_date)s)
            AND MONTH(date) = MONTH(%(target_date)s)
            AND YEAR(date) = YEAR(%(target_date)s)
        """

    elif compare_type == "Yearly":
        target_date = add_years(base_date, -1)
        condition = """
            DAY(date) = DAY(%(target_date)s)
            AND MONTH(date) = MONTH(%(target_date)s)
            AND YEAR(date) = YEAR(%(target_date)s)
        """
    else:
        return None

    params = {"target_date": target_date}
    extra = ""

    for f in ["zone", "region", "district", "branch"]:
        if filters.get(f):
            extra += f" AND {f} = %({f})s"
            params[f] = filters[f]

    query = f"""
        SELECT MAX(date)
        FROM `tabBranch Category Report`
        WHERE {condition}
        {extra}
    """

    return frappe.db.sql(query, params)[0][0]


# =========================================================
# CURRENT DATA - FIXED VERSION
# =========================================================
def get_current_data(filters):
    cond = ""
    params = {}

    # Date filter - mandatory
    if not filters.get("date"):
        frappe.throw("Date filter is required")
    
    cond += " AND bcr.date = %(date)s"
    params["date"] = filters["date"]

    # Zone, Region, District, Branch filters
    for f in ["zone", "region", "district", "branch"]:
        if filters.get(f):
            cond += f" AND bcr.{f} = %({f})s"
            params[f] = filters[f]

    # Type filter - always apply
    target_type = normalize_target_type(filters.get("type", "Monthly"))
    params["type"] = target_type

    # ✅ FIXED QUERY - Using GROUP BY to avoid duplicates
    query = f"""
        SELECT
            bcr.sol_id,
            bcr.branch,
            bcr.zone,
            bcr.region,
            bcr.district,
            bcr.date,
            bcr.achievement,
            MAX(tva.target) as target,
            bcr.branch_category
        FROM `tabBranch Category Report` bcr
        LEFT JOIN `tabTarget Vs Achivement` tva
            ON tva.sol_id = bcr.sol_id
            AND tva.type = %(type)s
        WHERE bcr.docstatus < 2
          AND TRIM(IFNULL(bcr.branch, '')) != '-'
        {cond}
        GROUP BY bcr.sol_id, bcr.branch, bcr.zone, bcr.region, 
                 bcr.district, bcr.date, bcr.achievement, bcr.branch_category
        ORDER BY bcr.zone, bcr.branch
    """

    return frappe.db.sql(query, params, as_dict=True)


# =========================================================
# PREVIOUS ACHIEVEMENT % MAP - FIXED VERSION
# =========================================================
def get_previous_achievement_map(filters):
    if not filters.get("date") or not filters.get("compare_type"):
        return {}

    prev_date = get_previous_date(filters["date"], filters["compare_type"], filters)
    if not prev_date:
        return {}

    params = {"prev_date": prev_date}
    cond = ""

    for f in ["zone", "region", "district", "branch"]:
        if filters.get(f):
            cond += f" AND bcr.{f} = %({f})s"
            params[f] = filters[f]

    # Type filter - always apply
    target_type = normalize_target_type(filters.get("type", "Monthly"))
    params["type"] = target_type

    # ✅ FIXED QUERY - Using GROUP BY
    query = f"""
        SELECT 
            bcr.sol_id, 
            bcr.achievement, 
            MAX(tva.target) as target
        FROM `tabBranch Category Report` bcr
        LEFT JOIN `tabTarget Vs Achivement` tva
            ON tva.sol_id = bcr.sol_id
            AND tva.type = %(type)s
        WHERE bcr.date = %(prev_date)s
        {cond}
        GROUP BY bcr.sol_id, bcr.achievement
    """

    rows = frappe.db.sql(query, params, as_dict=True)

    result = {}
    for r in rows:
        tgt = float(r.get("target") or 0)
        if tgt > 0:
            result[r["sol_id"]] = round((float(r.get("achievement") or 0) / tgt) * 100, 2)

    return result


# =========================================================
# PREVIOUS CATEGORY MAP - FIXED VERSION
# =========================================================
def get_previous_category_map(filters):
    if not filters.get("date") or not filters.get("compare_type"):
        return {}

    prev_date = get_previous_date(filters["date"], filters["compare_type"], filters)
    if not prev_date:
        return {}

    params = {"prev_date": prev_date}
    cond = ""

    for f in ["zone", "region", "district", "branch"]:
        if filters.get(f):
            cond += f" AND bcr.{f} = %({f})s"
            params[f] = filters[f]

    # Type filter - always apply
    target_type = normalize_target_type(filters.get("type", "Monthly"))
    params["type"] = target_type

    # ✅ FIXED QUERY - Using GROUP BY
    query = f"""
        SELECT 
            bcr.sol_id, 
            bcr.achievement, 
            MAX(tva.target) as target
        FROM `tabBranch Category Report` bcr
        LEFT JOIN `tabTarget Vs Achivement` tva
            ON tva.sol_id = bcr.sol_id
            AND tva.type = %(type)s
        WHERE bcr.date = %(prev_date)s
        {cond}
        GROUP BY bcr.sol_id, bcr.achievement
    """

    rows = frappe.db.sql(query, params, as_dict=True)

    prev_map = {}
    for r in rows:
        tgt = float(r.get("target") or 0)
        pct = round((float(r.get("achievement") or 0) / tgt) * 100, 2) if tgt > 0 else 0

        if pct > 100:
            cat = "Pinnacle"
        elif pct >= 80:
            cat = "Master"
        elif pct >= 60:
            cat = "Accelerator"
        elif pct >= 40:
            cat = "Starter"
        elif pct >= 20:
            cat = "Learner"
        else:
            cat = "Zero Level"

        prev_map[r["sol_id"]] = cat

    return prev_map


# =========================================================
# REPORT SUMMARY
# =========================================================
def _delta(current, previous):
    diff = current - previous
    if diff > 0:
        return f"+{diff}"
    return ""


def get_report_summary(data, prev_category_map):
    categories = ["Pinnacle", "Master", "Accelerator", "Starter", "Learner", "Zero Level"]

    current_counts = {c: 0 for c in categories}
    for r in data:
        if r.get("_cat") in current_counts:
            current_counts[r["_cat"]] += 1

    previous_counts = {c: 0 for c in categories}
    for cat in prev_category_map.values():
        if cat in previous_counts:
            previous_counts[cat] += 1

    def fmt(cur, prev):
        d = _delta(cur, prev)
        return f"{cur} ({d})" if d else f"{cur}"

    return [
        {"label": c, "value": fmt(current_counts[c], previous_counts[c]), "indicator": i}
        for c, i in [
            ("Pinnacle", "Purple"),
            ("Master", "Green"),
            ("Accelerator", "Blue"),
            ("Starter", "Orange"),
            ("Learner", "Yellow"),
            ("Zero Level", "Red"),
        ]
    ]


# =========================================================
# FINAL DATA (UPDATED SORT LOGIC)
# =========================================================
def build_final_data(current_rows, previous_map, filters, keep_category=False):
    CATEGORY_ORDER = {
        "Pinnacle": 1,
        "Master": 2,
        "Accelerator": 3,
        "Starter": 4,
        "Learner": 5,
        "Zero Level": 6,
    }

    ROW_COLORS = {
        "Pinnacle": "#efe9fb",
        "Master": "#e9f7ef",
        "Accelerator": "#eaf2ff",
        "Starter": "#fff3e6",
        "Learner": "#fff9db",
        "Zero Level": "#fdecea",
    }

    BADGE_COLORS = {
        "Pinnacle": "#6f42c1",
        "Master": "#198754",
        "Accelerator": "#0d6efd",
        "Starter": "#fd7e14",
        "Learner": "#ffc107",
        "Zero Level": "#dc3545",
    }

    for r in current_rows:
        ach = float(r.get("achievement") or 0)
        tgt = float(r.get("target") or 0)
        pct = round((ach / tgt) * 100, 2) if tgt > 0 else 0
        prev = previous_map.get(r["sol_id"], 0)

        r["_pct"] = pct
        r["_cmp"] = round(pct - prev, 2)

        if pct > 100:
            cat, band = "Pinnacle", ">100%"
        elif pct >= 80:
            cat, band = "Master", "80–100%"
        elif pct >= 60:
            cat, band = "Accelerator", "60–80%"
        elif pct >= 40:
            cat, band = "Starter", "40–60%"
        elif pct >= 20:
            cat, band = "Learner", "20–40%"
        else:
            cat, band = "Zero Level", "0–20%"

        r["_cat"] = cat
        r["_band"] = band
        r["_rank"] = CATEGORY_ORDER[cat]

    # ✅ UPDATED SORT LOGIC - New values
    sort_mode = filters.get("sort_mode", "Category Wise")  # Updated default

    if sort_mode == "Zone Wise":  # ✅ Updated value
        current_rows.sort(
            key=lambda x: (
                (x.get("zone") or ""),
                x["_rank"],
                -x["_pct"],
            )
        )
    else:  # Category Wise (default)
        current_rows.sort(
            key=lambda x: (
                x["_rank"],
                -x["_pct"],
            )
        )

    def wrap(val, bg):
        return f'<div style="background:{bg};padding:6px">{val}</div>'

    final = []

    for r in current_rows:
        bg = ROW_COLORS[r["_cat"]]
        badge = f'<span style="background:{BADGE_COLORS[r["_cat"]]};color:white;padding:4px 10px;border-radius:12px">{r["_cat"]}</span>'

        r["achievement"] = wrap(format_number(r.get("achievement")), bg)
        r["target"] = wrap(format_number(r.get("target")), bg)
        r["achievement_percent"] = wrap(f"{r['_pct']}%", bg)
        r["compare_percent"] = wrap(f"{r['_cmp']}%", bg)
        r["performance_category"] = wrap(badge, bg)
        r["achievement_band"] = wrap(r["_band"], bg)
        r["date"] = wrap(format_date_ddmmyy(r.get("date")), bg)

        for f in ["sol_id", "branch", "zone", "region", "district", "branch_category"]:
            r[f] = wrap(r.get(f), bg)

        for k in ["_pct", "_cmp", "_band", "_rank"]:
            r.pop(k, None)

        if not keep_category:
            r.pop("_cat", None)

        final.append(r)

    return final
