app_name = "custom_report"
app_title = "custom_report"
app_publisher = "atul"
app_description = "Department_wise_report"
app_email = "atulgnadekar@gmail.com"
app_license = "mit"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "custom_report",
# 		"logo": "/assets/custom_report/logo.png",
# 		"title": "custom_report",
# 		"route": "/custom_report",
# 		"has_permission": "custom_report.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/custom_report/css/custom_report.css"
# app_include_js = "/assets/custom_report/js/custom_report.js"

app_include_js = [
    "/assets/custom_report/js/petite-vue.js"
]

website_route_rules = [
	{"from_route": "/drishti/<path:app_path>", "to_route": "drishti"},
	{"from_route": "/bde_bdo_dashboard/<path:app_path>", "to_route": "bde_bdo_dashboard"},
	{"from_route": "/sync", "to_route": "sync"},
	{"from_route": "/sync.html", "to_route": "sync"},
	{"from_route": "/double_leg_transaction", "to_route": "double_leg_transaction"},
]


# include js, css files in header of web template
# web_include_css = "/assets/custom_report/css/custom_report.css"
# web_include_js = "/assets/custom_report/js/custom_report.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "custom_report/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "custom_report/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "custom_report.utils.jinja_methods",
# 	"filters": "custom_report.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "custom_report.install.before_install"
# after_install = "custom_report.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "custom_report.uninstall.before_uninstall"
# after_uninstall = "custom_report.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "custom_report.utils.before_app_install"
# after_app_install = "custom_report.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "custom_report.utils.before_app_uninstall"
# after_app_uninstall = "custom_report.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "custom_report.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
	"Sahayog Branch": {
		"on_update": "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.clear_sahayog_branches_cache",
		"on_trash": "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.clear_sahayog_branches_cache"
	},
	"Product": {
		"on_update": "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.clear_products_cache",
		"on_trash": "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.clear_products_cache"
	},
	"Report Preference": {
		"on_update": "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.clear_user_permissions_cache",
		"on_trash": "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.clear_user_permissions_cache"
	},
	"Target Vs Achivement": {
		"on_update": "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.clear_targets_cache",
		"on_trash": "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.clear_targets_cache"
	},
	"Branch Category Report": {
		"on_update": "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.clear_branch_category_report_cache",
		"on_trash": "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.clear_branch_category_report_cache"
	}
}

# Scheduled Tasks
# ---------------

scheduler_events = {
	"cron": {
		# Daily T-1 (Yesterday) SS & VS Report Synchronizations starting at 07:00 AM IST with 5-minute intervals
		"0 7 * * *": [
			"custom_report.custom_report.doctype.ss_and_vs_report.ss_vs_sync.sync_dd_sav_daily"
		],
		"5 7 * * *": [
			"custom_report.custom_report.doctype.ss_and_vs_report.ss_vs_sync.sync_dd_tda_daily"
		],
		"10 7 * * *": [
			"custom_report.custom_report.doctype.ss_and_vs_report.ss_vs_sync.sync_rd_daily"
		],
		"15 7 * * *": [
			"custom_report.custom_report.doctype.ss_and_vs_report.ss_vs_sync.sync_smbg_daily"
		],
		"20 7 * * *": [
			"custom_report.custom_report.doctype.ss_and_vs_report.ss_vs_sync.sync_fd_1_daily"
		],
		"25 7 * * *": [
			"custom_report.custom_report.doctype.ss_and_vs_report.ss_vs_sync.sync_dam_daily"
		],
		"30 7 * * *": [
			"custom_report.custom_report.doctype.ss_and_vs_report.ss_vs_sync.sync_fd_daily"
		],
		"35 7 * * *": [
			"custom_report.custom_report.doctype.ss_and_vs_report.ss_vs_sync.sync_share_daily"
		],
		"40 7 * * *": [
			"custom_report.custom_report.doctype.maturity_tracker.maturity_tracker.daily_sync_maturity_tracker"
		],
		"45 7 * * *": [
			"custom_report.custom_report.doctype.ss_and_vs_report.ss_vs_sync.cleanup_ss_vs_old_monthly_records"
		],
		"45 6 * * *": [
			"custom_report.custom_report.doctype.rd_and_smbg_pending.rd_and_smbg_pending.daily_sync_rd_and_smbg_pending"
		],
		# Daily Sahayog Dashboard and Financial Tracker Synchronizations starting at 08:10 AM IST
		"10 8 * * *": [
			"custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.daily_tda_sync"
		],
		"15 8 * * *": [
			"custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.daily_casa_sync"
		],
		"20 8 * * *": [
			"custom_report.custom_report.page.sahayog_dashboard.achievement.daily_sync_cron"
		],
		"30 8 * * *": [
			"custom_report.custom_report.doctype.book_position_and_account_details.book_position_and_account_details.daily_sync_book_position"
		],
		"40 8 * * *": [
			"custom_report.custom_report.doctype.dd_tracker_report.dd_tracker_report.daily_sync_dd_tracker"
		]
	}
}

# Testing
# -------

# before_tests = "custom_report.install.before_tests"

# Overriding Methods
# ------------------------------
#
override_whitelisted_methods = {
	"custom_report.api.test_connection": "custom_report.report_module.test_db_connection"
}
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "custom_report.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["custom_report.utils.before_request"]
# after_request = ["custom_report.utils.after_request"]

# Job Events
# ----------
# before_job = ["custom_report.utils.before_job"]
# after_job = ["custom_report.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"custom_report.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }
