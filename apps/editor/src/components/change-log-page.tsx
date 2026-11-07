import "../styles/gallery-entry.css";
import "../styles/privacy.css";

import { usePageTitle } from "../app/use-page-title";
import { CHANGE_LOG, type ChangeLogDay } from "./change-log";
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
  days: readonly ChangeLogDay[] = CHANGE_LOG,
): { month: string; days: ChangeLogDay[] }[] {
  const months: { month: string; days: ChangeLogDay[] }[] = [];
  for (const day of days) {
    const month = MONTH.format(at(day.date));
    const last = months.at(-1);
    if (last?.month === month) last.days.push(day);
    else months.push({ month, days: [day] });
  }
  return months;
}

/**
 * `/changelog`: what changed each day, readable signed out; a day of several
 * changes numbers them.
 */
export function ChangeLogPage() {
  usePageTitle("Change log");
  return (
    <main className="review-shell" data-testid="change-log-page">
      <GalleryChrome subtitle="Change log" />
      <article className="page-body privacy-document change-log">
        <h1>Change log</h1>
        <p className="privacy-updated">
          What changed in Analog Canvas, day by day. Every commit is on{" "}
          <a href={`${SITE_REPOSITORY_URL}/commits/main`}>GitHub</a>.
        </p>
        {changeLogMonths().map(({ month, days }) => (
          <section key={month} aria-label={month}>
            <h2>{month}</h2>
            <ol className="change-log-days">
              {days.map((day) => (
                <li key={day.date} data-testid="change-log-day">
                  <time dateTime={day.date}>{DAY.format(at(day.date))}</time>
                  {day.items.length === 1 ? (
                    <span>{day.items[0]}</span>
                  ) : (
                    <ol className="change-log-items">
                      {day.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ol>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </article>
    </main>
  );
}
