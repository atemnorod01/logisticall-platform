import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { OrganizationContext } from "../../../packages/types/src/index.js";
import { contactIds, contactsController } from "./contacts.js";
import { Avatar, Icon } from "./ui.js";
export function Contacts({
  userId,
  organization,
  onCalls,
}: {
  userId: string;
  organization: OrganizationContext;
  onCalls: () => void;
}) {
  const controller = useMemo(
    () => contactsController(organization.organization_id),
    [organization.organization_id],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState(false);
  const scope = `${userId}:${organization.organization_id}`;
  const storage = () => {
    try {
      return localStorage;
    } catch {
      return undefined;
    }
  };
  const [favorites, setFavorites] = useState(() =>
    contactIds(storage(), `logisticall.contact.favorites.${scope}`),
  );
  const [recent, setRecent] = useState(() =>
    contactIds(storage(), `logisticall.contact.recent.${scope}`),
  );
  const [preferenceError, setPreferenceError] = useState("");
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    setSelected("");
    setDetail(false);
    const timer = setTimeout(() => void controller.load(search), 200);
    return () => clearTimeout(timer);
  }, [controller, search]);
  useEffect(() => {
    document
      .getElementById("app")
      ?.classList.toggle("workspace-detail-open", detail);
    return () =>
      document.getElementById("app")?.classList.remove("workspace-detail-open");
  }, [detail]);
  // Revalidate membership and discard stale directory data on a periodic visible refresh.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void controller.load();
    }, 60000);
    return () => clearInterval(timer);
  }, [controller]);
  function save(kind: "favorites" | "recent", ids: string[]) {
    try {
      const store = storage();
      if (!store) throw Error();
      store.setItem(`logisticall.contact.${kind}.${scope}`, JSON.stringify(ids));
    } catch {
      setPreferenceError(
        "Preferences are available for this visit only. Browser storage is unavailable.",
      );
    }
  }
  function favorite(id: string) {
    const ids = favorites.includes(id)
      ? favorites.filter((x) => x !== id)
      : [id, ...favorites].slice(0, 200);
    setFavorites(ids);
    save("favorites", ids);
  }
  function select(id: string) {
    setSelected(id);
    setDetail(true);
    const ids = [id, ...recent.filter((x) => x !== id)].slice(0, 20);
    setRecent(ids);
    save("recent", ids);
  }
  const rows = (state.search === search ? state.rows : []).filter((c) =>
    filter === "personal"
      ? false
      : filter === "favorites"
        ? favorites.includes(c.id)
        : filter === "recent"
          ? recent.includes(c.id)
          : true,
  );
  const current = rows.find((c) => c.id === selected) ?? rows[0];
  const loading = state.loading || state.search !== search;
  return (
    <div className="split">
      <section className="center">
        <h1>Contacts</h1>
        <p className="sub">Your contacts, all in one place.</p>
        <label className="workspace-page-search">
          <span>Search</span>
          <input
            id="workspace-search"
            type="search"
            aria-label="Search Contacts"
            placeholder="Search contacts…"
            maxLength={100}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="tools">
          <div className="tabs pills">
            {[
              ["all", "All"],
              ["favorites", "Favorites"],
              ["directory", "Company"],
              ["personal", "Personal"],
              ["recent", "Recent"],
            ].map(([key, label]) => (
              <button
                type="button"
                key={key}
                className={filter === key ? "active" : ""}
                aria-pressed={filter === key}
                onClick={() => {
                  setFilter(key!);
                  setSelected("");
                  setDetail(false);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="smalltools">
            <button
              className="icon"
              aria-label="Refresh contacts"
              disabled={loading}
              onClick={() => void controller.load(search)}
            >
              <Icon name="filter" />
            </button>
          </div>
        </div>
        {state.error && (
          <p role="alert">
            {state.error}{" "}
            <button
              className="button"
              onClick={() => void controller.load(search)}
            >
              Try again
            </button>
          </p>
        )}
        {preferenceError && <p role="status">{preferenceError}</p>}
        <div className="countline">
          <span>{rows.length} contacts loaded</span>
          <span>Sort by: Name (A–Z)　≡</span>
        </div>
        <div className="contacts-list" aria-busy={loading}>
          {rows.map((c) => (
            <div
              key={c.id}
              className={`contact-row ${current?.id === c.id ? "chosen" : ""}`}
            >
              <button
                type="button"
                className={`star ${favorites.includes(c.id) ? "is-favorite" : ""}`}
                aria-label={`Favorite ${c.name}`}
                aria-pressed={favorites.includes(c.id)}
                onClick={() => favorite(c.id)}
              >
                <Icon name="star" />
              </button>
              <button
                type="button"
                className="person"
                onClick={() => select(c.id)}
                aria-label={`View ${c.name}`}
              >
                <Avatar name={c.name} presence={c.presence} />
                <span>
                  <strong>{c.name}</strong>
                  <small>{organization.name}</small>
                </span>
              </button>
              <div className="contact-info">
                <span>
                  <Icon name="phone" />
                  No phone assigned
                </span>
                <span>
                  <Icon name="mail" />
                  {c.email}
                </span>
              </div>
              <div className="row-actions">
                <button
                  className="icon"
                  disabled
                  aria-label={`Call ${c.name}`}
                  title="Calling is not connected"
                >
                  <Icon name="phone" />
                </button>
                <button
                  className="icon"
                  disabled
                  aria-label={`Message ${c.name}`}
                  title="Messaging is not connected"
                >
                  <Icon name="message" />
                </button>
              </div>
            </div>
          ))}
          {!rows.length && (
            <div className="empty" role="status">
              {loading
                ? "Loading contacts…"
                : state.error
                  ? "Directory unavailable."
                  : filter === "personal"
                    ? "Personal contacts are not connected yet."
                    : filter === "favorites"
                      ? "No favorites in the loaded contacts."
                      : filter === "recent"
                        ? "No recently viewed contacts in this list."
                        : search
                          ? "No matching contacts."
                          : "No active company contacts."}
            </div>
          )}
        </div>
        {state.nextOffset !== null && (
          <button
            className="button"
            disabled={loading}
            onClick={() => void controller.load(search, true)}
          >
            Load more contacts
          </button>
        )}
        <p className="quiet">
          Company directory · Favorites and recent selections are saved in this
          browser. Contact creation is managed outside this workspace.
        </p>
      </section>
      <aside className="details" aria-label="Contact details">
        <button
          className="icon workspace-details-back"
          aria-label="Back to list"
          onClick={() => setDetail(false)}
        >
          ←
        </button>
        <div className="section-head">
          <h2>Contact Details</h2>
          <button className="icon" disabled aria-label="Contact options">
            <Icon name="more" />
          </button>
        </div>
        {current ? (
          <>
            <div className="contact-hero">
              <Avatar name={current.name} presence={current.presence} large />
              <div>
                <h3>{current.name}</h3>
                <p>{organization.name}</p>
                <p>Presence: {current.presence}</p>
              </div>
            </div>
            <div className="actions">
              <button
                className="button primary"
                disabled
                title="Calling is not connected"
              >
                <Icon name="phone" />
                Call
              </button>
              <button
                className="button"
                disabled
                title="Messaging is not connected"
              >
                <Icon name="message" />
                Message
              </button>
              <button
                className="icon"
                disabled
                aria-label="More contact actions"
              >
                <Icon name="more" />
              </button>
            </div>
            <div className="phone-line">
              <Icon name="mail" />
              <a href={`mailto:${current.email}`}>{current.email}</a>
            </div>
            <div className="phone-line">
              <Icon name="users" />
              {organization.name}
            </div>
            <div className="divider">
              <h3>Sources</h3>
              <div className="tags">
                <span className="tag">Company directory</span>
              </div>
            </div>
            <div className="divider">
              <div className="section-head">
                <h3>Recent interactions</h3>
                <button className="see-all" onClick={onCalls}>
                  See all
                </button>
              </div>
              <p className="quiet">
                Calling and messaging are not connected yet.
              </p>
            </div>
            <input
              className="note"
              disabled
              placeholder="Contact notes are not connected yet"
              aria-label="Contact note"
            />
          </>
        ) : (
          <p className="sub">Select a contact to view details.</p>
        )}
      </aside>
    </div>
  );
}
