import frappe
from psycopg2.extras import RealDictCursor
from custom_report.db_connection import get_dr_connection

def get_context(context):
    # Prevent caching and require login
    context.no_cache = 1
    context.login_required = True
    
    # Check if user has "CIF Tracker" role
    context.has_access = check_user_access()

def check_user_access():
    """Helper to check if user has access based on designation OR role"""
    user = frappe.session.user
    if user == "Administrator":
        return True

    user_roles = set(frappe.get_roles(user))
    if "System Manager" in user_roles:
        return True
        
    # Check designation first (Full access for these designations)
    designation = frappe.db.get_value("Employee", {"user_id": user}, "designation")
    if designation in ['BRANCH MANAGER', 'Branch Operation Manager', 'CLUSTER OPERATION MANAGER', 'Asst. Branch Manager', 'BRANCH MANAGER JLL','Sr. Branch Manager','Asst. Branch Manager JLL']:
        return True

    # Fallback to role-based access if designation doesn't match
    if "CIF Tracker" in user_roles:
        return True
        
    return False

@frappe.whitelist()
def get_cif_details(cif_id):
    # Security check for API call
    if not check_user_access():
        frappe.throw("Only BOM, ABM, BM, Sr. BM and COM users have access to the CIF Tracker; please connect with them for assistance.", frappe.PermissionError)

    if not cif_id or len(str(cif_id)) < 4 or len(str(cif_id)) > 9:
        return {"success": False, "error": "CIF ID must be between 4 and 9 digits"}

    conn = None
    try:
        conn = get_dr_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        query = """
            SELECT COALESCE(c.cif_id, am.orgkey)            AS cif_id,
                   COALESCE(c.cust_name, am.name)           AS cust_name,      
                   -- ==================== ACTION TYPE ====================
                   CASE
                       WHEN c.cif_id IS NOT NULL AND am.orgkey IS NOT NULL AND am.recordstatus IN ('D', 'F', 'R')
                           THEN 'MODIFICATION (IN-PROGRESS)'
                       WHEN aud.mod_maker_id IS NOT NULL OR (c.lchg_time::DATE > c.rcre_time::DATE)
                           THEN 'MODIFICATION'
                       ELSE 'CREATION'
                   END AS action_type,
                   -- ==================== CUSTOMER TYPE ====================
                   CASE
                       WHEN corp.corp_key IS NOT NULL THEN 'CORPORATE'
                       ELSE 'RETAIL'
                   END AS cif_type,
                   -- ==================== SOL DETAILS ====================
                   COALESCE(c.primary_sol_id, am.primary_sol_id) AS sol_id,
                   s.sol_desc                                    AS sol_desc,           
                   -- ==================== MAKER DETAILS (NEVER NULL) ====================
                   COALESCE(
                       NULLIF(TRIM(aud.mod_maker_id::TEXT), ''),
                       CASE WHEN am.recordstatus IN ('D', 'R') THEN NULLIF(TRIM(am.assignedto::TEXT), '') ELSE NULL END,
                       CASE WHEN c.rcre_user_id NOT IN ('7', 'FIVUSR') THEN NULLIF(TRIM(c.rcre_user_id), '') ELSE NULL END,
                       CASE WHEN a.bocreatedby NOT IN (7) THEN NULLIF(TRIM(a.bocreatedby::TEXT), '') ELSE NULL END,
                       NULLIF(TRIM(c.rcre_user_id), ''),
                       NULLIF(TRIM(am.assignedto::TEXT), ''),
                       NULLIF(TRIM(a.bocreatedby::TEXT), '')
                   ) AS maker_id,
                   u_mkr.loginid                            AS maker_login_id,
                   COALESCE(
                       NULLIF(TRIM(g_mkr.emp_name), ''),
                       NULLIF(TRIM(CONCAT(p_mkr.firstname, ' ', p_mkr.lastname)), ''),
                       u_mkr.loginid
                   ) AS maker_name,
                   TO_CHAR(COALESCE(c.lchg_time, am.tmdate, c.rcre_time), 'HH24:MI:SS') AS saved_time,
                   TO_CHAR(COALESCE(aud.mod_date::DATE, c.lchg_time::DATE, am.tmdate::DATE, c.rcre_time::DATE), 'DD-MM-YYYY') AS created_date,          
                   -- ==================== CHECKER DETAILS (NEVER SAME AS MAKER) ====================
                   CASE
                       WHEN am.recordstatus = 'F' OR a.recordstatus = 'U'
                           THEN CASE
                               WHEN u_chk.loginid = u_mkr.loginid THEN bc.def_checker_id
                               ELSE COALESCE(u_chk.loginid, bc.def_checker_id)
                           END
                       WHEN c.entity_cre_flg = 'Y' OR a.recordstatus = 'A'
                           THEN COALESCE(u_appr.loginid, bc.def_checker_id, 'VERIFIED')
                       WHEN am.recordstatus = 'R'
                           THEN COALESCE(u_chk.loginid, u_appr.loginid, bc.def_checker_id, 'CHECKER')
                       ELSE COALESCE(bc.def_checker_id, 'UNASSIGNED')
                   END AS checker_login_id,    
                   CASE
                       WHEN am.recordstatus = 'F' OR a.recordstatus = 'U'
                           THEN CASE
                               WHEN u_chk.loginid = u_mkr.loginid THEN bc.def_checker_name
                               ELSE COALESCE(
                                   NULLIF(TRIM(g_chk.emp_name), ''),
                                   NULLIF(TRIM(CONCAT(p_chk.firstname, ' ', p_chk.lastname)), ''),
                                   bc.def_checker_name,
                                   u_chk.loginid,
                                   bc.def_checker_id
                               )
                           END
                       WHEN c.entity_cre_flg = 'Y' OR a.recordstatus = 'A'
                           THEN COALESCE(
                               NULLIF(TRIM(g_appr.emp_name), ''),
                               NULLIF(TRIM(CONCAT(p_appr.firstname, ' ', p_appr.lastname)), ''),
                               NULLIF(TRIM(bc.def_checker_name), ''),
                               u_appr.loginid,
                               bc.def_checker_id
                           )
                       WHEN am.recordstatus = 'R'
                           THEN COALESCE(
                               NULLIF(TRIM(g_chk.emp_name), ''),
                               NULLIF(TRIM(CONCAT(p_chk.firstname, ' ', p_chk.lastname)), ''),
                               NULLIF(TRIM(g_appr.emp_name), ''),
                               NULLIF(TRIM(CONCAT(p_appr.firstname, ' ', p_appr.lastname)), ''),
                               bc.def_checker_name,
                               bc.def_checker_id
                           )
                       ELSE COALESCE(NULLIF(TRIM(bc.def_checker_name), ''), 'Branch Supervisor')
                   END AS checker_person_name,
                   -- ==================== VERIFIED TIME & DATE ====================
                   CASE
                       WHEN am.recordstatus = 'F' OR a.recordstatus = 'U'
                           THEN CONCAT('Pending (', TO_CHAR(COALESCE(am.tmdate, c.rcre_time), 'HH24:MI:SS'), ')')
                       WHEN am.recordstatus = 'R'
                           THEN CONCAT('Rejected (', TO_CHAR(COALESCE(c.lchg_time, am.tmdate), 'HH24:MI:SS'), ')')
                       WHEN c.entity_cre_flg = 'Y' OR a.recordstatus = 'A'
                           THEN TO_CHAR(c.lchg_time, 'HH24:MI:SS')
                       WHEN am.recordstatus = 'D' OR a.recordstatus = 'I'
                           THEN CONCAT('Draft (', TO_CHAR(COALESCE(am.tmdate, c.rcre_time), 'HH24:MI:SS'), ')')
                       ELSE 'Not Verified'
                   END AS verified_time,
                   CASE
                       WHEN am.recordstatus = 'F' OR a.recordstatus = 'U'
                           THEN CONCAT('Pending (', TO_CHAR(COALESCE(am.tmdate::DATE, c.rcre_time::DATE), 'DD-MM-YYYY'), ')')
                       WHEN am.recordstatus = 'R'
                           THEN CONCAT('Rejected (', TO_CHAR(COALESCE(c.lchg_time, am.tmdate), 'DD-MM-YYYY'), ')')
                       WHEN c.entity_cre_flg = 'Y' OR a.recordstatus = 'A'
                           THEN TO_CHAR(c.lchg_time, 'DD-MM-YYYY')
                       WHEN am.recordstatus = 'D' OR a.recordstatus = 'I'
                           THEN CONCAT('Draft (', TO_CHAR(COALESCE(am.tmdate::DATE, c.rcre_time::DATE), 'DD-MM-YYYY'), ')')
                       ELSE 'Not Verified'
                   END AS verified_date,
                   -- ==================== RAW TECHNICAL STATUS CODES ====================
                   c.entity_cre_flg                         AS core_flg,
                   a.recordstatus                           AS acc_status,
                   am.recordstatus                          AS mod_status,
                   -- ==================== EXACT STATUS ====================
                   CASE
                       WHEN c.del_flg = 'Y'
                           THEN 'Deleted / Cancelled'
                       WHEN c.cif_id IS NOT NULL AND am.recordstatus = 'F'
                           THEN 'Modification (Pending Checker)'
                       WHEN c.cif_id IS NOT NULL AND am.recordstatus = 'D'
                           THEN 'Modification (Draft / Maker Tray)'
                       WHEN c.cif_id IS NOT NULL AND am.recordstatus = 'R'
                           THEN 'Modification (Rejected by Checker)'
                       WHEN am.recordstatus = 'R'
                           THEN 'Rejected by Checker'
                       WHEN am.recordstatus = 'F' OR a.recordstatus = 'U'
                           THEN 'Unverified (Pending Checker)'
                       WHEN am.recordstatus = 'D' OR a.recordstatus = 'I'
                           THEN 'Unverified (Draft / Maker Tray)'
                       WHEN c.entity_cre_flg = 'Y' OR a.recordstatus = 'A'
                           THEN 'Verified'
                       ELSE 'Unverified'
                   END AS exact_status,
                   -- ==================== CURRENT TRAY SUMMARY ====================
                   CASE
                       WHEN c.cif_id IS NOT NULL AND am.recordstatus = 'F'
                           THEN CONCAT('Modification Pending with Checker: ', COALESCE(NULLIF(TRIM(g_chk.emp_name), ''), NULLIF(TRIM(CONCAT(p_chk.firstname, ' ', p_chk.lastname)), ''), bc.def_checker_name, u_chk.loginid))
                       WHEN c.cif_id IS NOT NULL AND am.recordstatus = 'D'
                           THEN CONCAT('Modification Pending with Maker: ', COALESCE(NULLIF(TRIM(g_mkr.emp_name), ''), NULLIF(TRIM(CONCAT(p_mkr.firstname, ' ', p_mkr.lastname)), ''), u_mkr.loginid))
                       WHEN c.cif_id IS NOT NULL AND am.recordstatus = 'R'
                           THEN CONCAT('Modification Rejected - In Maker Tray: ', COALESCE(NULLIF(TRIM(g_mkr.emp_name), ''), u_mkr.loginid))
                       WHEN c.entity_cre_flg = 'Y' OR a.recordstatus = 'A'
                           THEN CONCAT('Verified By: ', COALESCE(NULLIF(TRIM(g_appr.emp_name), ''), NULLIF(TRIM(CONCAT(p_appr.firstname, ' ', p_appr.lastname)), ''), bc.def_checker_name, u_appr.loginid), ' at ', TO_CHAR(c.lchg_time, 'HH24:MI:SS'))
                       WHEN am.recordstatus = 'R'
                           THEN CONCAT('Rejected - In Maker Tray: ', COALESCE(NULLIF(TRIM(g_mkr.emp_name), ''), u_mkr.loginid))
                       WHEN am.recordstatus = 'F' OR a.recordstatus = 'U'
                           THEN CONCAT('Pending with Checker: ', COALESCE(NULLIF(TRIM(g_chk.emp_name), ''), NULLIF(TRIM(CONCAT(p_chk.firstname, ' ', p_chk.lastname)), ''), bc.def_checker_name, u_chk.loginid))
                       WHEN am.recordstatus = 'D' OR a.recordstatus = 'I'
                           THEN CONCAT('Pending with Maker: ', COALESCE(NULLIF(TRIM(g_mkr.emp_name), ''), NULLIF(TRIM(CONCAT(p_mkr.firstname, ' ', p_mkr.lastname)), ''), u_mkr.loginid))
                       ELSE 'Incomplete'
                   END AS current_tray_status
            FROM crmuser.cmg c
            FULL OUTER JOIN crmuser.accounts_mod am
                   ON TRIM(c.cif_id) = TRIM(am.orgkey)
            LEFT JOIN tbaadm.sol s
                   ON TRIM(COALESCE(c.primary_sol_id, am.primary_sol_id)) = TRIM(s.sol_id)
            LEFT JOIN crmuser.accounts a
                   ON TRIM(COALESCE(c.cif_id, am.orgkey)) = TRIM(a.orgkey)
            LEFT JOIN crmuser.corporate corp
                   ON TRIM(COALESCE(c.cif_id, am.orgkey)) = TRIM(corp.corp_key)
            LEFT JOIN (
                SELECT DISTINCT ON (TRIM(orgkey))
                    TRIM(orgkey) AS orgkey,
                    bocreatedby  AS mod_maker_id,
                    bomodifiedby AS mod_checker_id,
                    bodatecreated AS mod_date
                FROM crmuser.audittrail
                WHERE bomodifiedby IS NOT NULL
                  AND bocreatedby != bomodifiedby
                  AND bocreatedby != 7
                ORDER BY TRIM(orgkey), auditid DESC
            ) aud ON TRIM(COALESCE(c.cif_id, am.orgkey)) = aud.orgkey
            LEFT JOIN (
                SELECT DISTINCT ON (TRIM(u.sol_id))
                    TRIM(u.sol_id) AS sol_id,
                    u.user_id      AS def_checker_id,
                    g.emp_name     AS def_checker_name
                FROM tbaadm.upr u
                JOIN tbaadm.get g
                  ON TRIM(u.user_id) = TRIM(g.emp_id)
                WHERE u.del_flg = 'N'
                  AND u.user_work_class IN ('301', '401')
                ORDER BY TRIM(u.sol_id), u.user_work_class DESC, u.user_id
            ) bc ON TRIM(COALESCE(c.primary_sol_id, am.primary_sol_id)) = bc.sol_id
            LEFT JOIN crmuser.users u_mkr
                   ON TRIM(
                       COALESCE(
                           NULLIF(TRIM(aud.mod_maker_id::TEXT), ''),
                           CASE WHEN am.recordstatus IN ('D', 'R') THEN NULLIF(TRIM(am.assignedto::TEXT), '') ELSE NULL END,
                           CASE WHEN c.rcre_user_id NOT IN ('7', 'FIVUSR') THEN NULLIF(TRIM(c.rcre_user_id), '') ELSE NULL END,
                           CASE WHEN a.bocreatedby NOT IN (7) THEN NULLIF(TRIM(a.bocreatedby::TEXT), '') ELSE NULL END,
                           NULLIF(TRIM(c.rcre_user_id), ''),
                           NULLIF(TRIM(am.assignedto::TEXT), ''),
                           NULLIF(TRIM(a.bocreatedby::TEXT), '')
                       )
                   ) = u_mkr.personid::TEXT
            LEFT JOIN tbaadm.get g_mkr
                   ON TRIM(u_mkr.loginid) = TRIM(g_mkr.emp_id)
            LEFT JOIN crmuser.person p_mkr
                   ON u_mkr.personid = p_mkr.personid
            LEFT JOIN crmuser.users u_chk
                   ON COALESCE(am.assignedto, am.bomodifiedby) = u_chk.personid
            LEFT JOIN tbaadm.get g_chk
                   ON TRIM(u_chk.loginid) = TRIM(g_chk.emp_id)
            LEFT JOIN crmuser.person p_chk
                   ON u_chk.personid = p_chk.personid
            LEFT JOIN crmuser.users u_appr
                   ON TRIM(COALESCE(c.lchg_user_id, aud.mod_checker_id::TEXT)) = u_appr.personid::TEXT
            LEFT JOIN tbaadm.get g_appr
                   ON TRIM(u_appr.loginid) = TRIM(g_appr.emp_id)
            LEFT JOIN crmuser.person p_appr
                   ON u_appr.personid = p_appr.personid
            WHERE COALESCE(c.del_flg, 'N') = 'N'
              AND TRIM(COALESCE(c.cif_id, am.orgkey)) = %s
            ORDER BY COALESCE(aud.mod_date::DATE, c.lchg_time::DATE, am.tmdate::DATE, c.rcre_time::DATE) DESC;
        """
        cursor.execute(query, (str(cif_id).strip(),))
        rows = cursor.fetchall()
        
        data = []
        if rows:
            for r in rows:
                item = dict(r)
                for k, v in item.items():
                    if v is not None and hasattr(v, 'isoformat'):
                        item[k] = v.isoformat()
                data.append(item)
        
        if data:
            return {"success": True, "data": data}
        else:
            return {"success": False, "error": "No details found for the entered CIF."}

    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="CIF Tracker Error")
        return {"success": False, "error": str(e)}
    finally:
        if conn:
            conn.close()
