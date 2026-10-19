import type {ReactNode} from 'react';

export function OrganizationPageHeader({title, description, tabs, actions, meta}: {
  title: string;
  description: string;
  tabs?: ReactNode;
  actions: ReactNode;
  meta?: ReactNode;
}) {
  return <header className="lc-org-page-header">
    <div className="lc-org-heading-copy">
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
    <div className="lc-org-heading-row">
      {tabs && <div className="lc-org-page-tabs">{tabs}</div>}
      <div className="lc-org-page-actions">
        {meta && <span className="lc-org-page-meta">{meta}</span>}
        {actions}
      </div>
    </div>
  </header>;
}
