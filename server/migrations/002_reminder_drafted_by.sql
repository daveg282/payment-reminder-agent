-- Who wrote each draft: Gemini ('ai') or the fixed fallback template ('template').
alter table reminders add column drafted_by text not null default 'template' check (drafted_by in ('ai','template'));
