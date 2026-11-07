import "../styles/gallery-entry.css";
import "../styles/privacy.css";

import { usePageTitle } from "../app/use-page-title";
import { CHANGE_LOG } from "./change-log";
import { GalleryChrome } from "./gallery-chrome";
import { SITE_REPOSITORY_URL } from "./site-resource-links";

const MONTH = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const at = (date: string) => new Date(`${date}T00:00:00.000Z`);

/** The change log's days by month, newest first, as the page lists them. */
export function changeLogMonths(
  days: readonly { date: string; summary: string }[] = CHANGE_LOG,
): { month: string; days: { date: string; summary: string }[] }[] {
  const months: { month: string; days: { date: string; summary: string }[] }[] =
    [];
  for (const day of days) {
    const month = MONTH.format(at(day.date));
    const last = months.at(-1);
    if (last?.month === month) last.days.push(day);
    else months.push({ month, days: [day] });
  }
  return months;
}

/** `/changelog`: what changed, one line a day, readable signed out. */
export function ChangeLogPage() {
  usePageTitle("Change log");
  return (
    <main className="review-shell" data-testid="change-log-page">
      <GalleryChrome subtitle="Change log" />
      <article className="page-body privacy-document change-log">
        <h1>Change log</h1>
        <p className="privacy-updated">
          What changed in Analog Canvas, one line a day. Every commit is on{" "}
          <a href={`${SITE_REPOSITORY_URL}/commits/main`}>GitHub</a>.
        </p>
        {changeLogMonths().map(({ month, days }) => (
          <section key={month} aria-label={month}>
            <h2>{month}</h2>
            <ol className="change-log-days">
              {days.map((day) => (
                <li key={day.date} data-testid="change-log-day">
                  <time dateTime={day.date}>{DAY.format(at(day.date))}</time>
                  <span>{day.summary}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </article>
    </main>
  );
}
