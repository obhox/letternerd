import { can } from "@cms/core/roles";

/**
 * Navigation, grouped.
 *
 * Ten flat entries in a row read as a list of ten equally-important things,
 * which none of them are. Grouping states the shape of the tool instead:
 * what you write, what you write it with, how it performed, and how the site
 * is wired. It also leaves room to grow without the strip overflowing.
 *
 * Entries a role cannot use are omitted rather than disabled — a disabled link
 * invites a support question, an absent one does not, and the server refuses
 * the route regardless. This is presentation, not enforcement.
 */
export interface NavItem {
  href: string;
  label: string;
  needs?: (role: string) => boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Content",
    items: [
      { href: "", label: "Overview" },
      { href: "/posts", label: "Posts" },
      { href: "/pages", label: "Pages" },
      { href: "/blocks", label: "Blocks" },
    ],
  },
  {
    label: "Library",
    items: [
      { href: "/media", label: "Media" },
      { href: "/authors", label: "Authors", needs: can.manageAuthors },
      { href: "/taxonomy", label: "Taxonomy", needs: can.manageTaxonomy },
    ],
  },
  {
    label: "Performance",
    items: [{ href: "/insights", label: "Insights" }],
  },
  {
    label: "Connect",
    items: [{ href: "/install", label: "Install on your site" }],
  },
  {
    label: "Configure",
    items: [
      { href: "/redirects", label: "Redirects", needs: can.manageRedirects },
      { href: "/settings", label: "Settings", needs: can.manageSite },
    ],
  },
];

export function visibleGroups(role: string): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.needs || item.needs(role)),
  })).filter((group) => group.items.length > 0);
}

/**
 * Overview matches only its exact path; everything else matches its subtree,
 * so editing a post keeps Posts marked current.
 */
export function isCurrent(pathname: string, base: string, href: string): boolean {
  const full = `${base}${href}`;
  return href === "" ? pathname === full : pathname === full || pathname.startsWith(`${full}/`);
}
