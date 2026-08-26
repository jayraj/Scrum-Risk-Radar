import sys
from config import settings, UserConfig
from jira_fetcher import fetch_all, JiraFetcher

cfg = UserConfig.from_defaults()
print("projects:", cfg.jira_projects, "url:", cfg.jira_cloud_url, "email set:", bool(cfg.jira_email), "token set:", bool(cfg.jira_api_token))
f = JiraFetcher(cfg)
data = fetch_all(f)
print("=== sprint_data ===")
for pk, bundle in data.get("sprint_data", {}).items():
    s = bundle.get("sprint") or {}
    print(f"{pk}: name={s.get('name')!r} startDate={s.get('startDate')!r} endDate={s.get('endDate')!r}")
print("=== next_sprint_data ===")
for pk, bundle in data.get("next_sprint_data", {}).items():
    s = bundle.get("sprint") or {}
    print(f"{pk}: name={s.get('name')!r} startDate={s.get('startDate')!r} endDate={s.get('endDate')!r}")
