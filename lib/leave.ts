/**
 * Leave the page on purpose (after deleting the account): no "Leave site?"
 * prompt from anything else's beforeunload, and no stale auth state waiting
 * on the other side. `armLeaveGuard` runs once at app start so its listener
 * is first in line.
 */
let leaving = false

export function armLeaveGuard() {
  window.addEventListener(
    "beforeunload",
    (e) => {
      if (leaving) e.stopImmediatePropagation()
    },
    true
  )
}

export function leaveTo(url: string) {
  leaving = true
  try {
    // Better Auth's cross-domain client keeps the cookies and a session
    // cache here; after a deletion they describe a user that no longer
    // exists, and the next load would briefly act on them.
    localStorage.removeItem("better-auth_cookie")
    localStorage.removeItem("better-auth_session_data")
  } catch {}
  window.location.replace(url)
}
