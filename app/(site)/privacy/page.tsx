import Link from "next/link"

export const metadata = { title: "Privacy · Reframe" }

const UPDATED = "15 September 2026"

/** Plain-language privacy policy; also the URL Google's OAuth branding requires. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-sm leading-relaxed">
      <Link
        href="/"
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← Reframe
      </Link>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Privacy</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Last updated {UPDATED}
      </p>

      <Section title="What Reframe is">
        Reframe turns a diagram you draw into a prompt for a coding agent by
        interviewing you about it. It is a small, single-purpose tool. This page
        says what it stores, where, and why.
      </Section>

      <Section title="Your drawings and interviews">
        The drawings you make, your answers to the interview, and the prompts
        that come out of them are saved to the app&apos;s database (hosted on{" "}
        <a href="https://www.convex.dev" className="underline">
          Convex
        </a>
        ) so you can come back to them. A picture of your canvas is also stored
        briefly so the model can look at it during an interview. Nothing you
        make is shared with other users or used to train anything.
      </Section>

      <Section title="Your API key">
        Reframe is bring-your-own-key. The key you enter (Anthropic, OpenAI,
        OpenRouter or Google) is kept in your browser&apos;s local storage and
        is sent to the server only for the duration of each request, where it is
        forwarded to the provider you chose. It is never written to the database
        or to logs. Remove it at any time from the key dialog or by clearing
        site data.
      </Section>

      <Section title="What the model sees">
        Each interview sends your drawing (as text and as an image), your
        answers, and the questions so far to the model provider whose key you
        supplied. That provider&apos;s own privacy terms apply to what they do
        with it.
      </Section>

      <Section title="Accounts">
        You can use Reframe without signing in; an anonymous account is created
        in your browser so your projects persist there. If you sign in with
        GitHub or Google, Reframe stores the email address and display name
        those providers return, so your projects follow you across devices.
        Nothing else is read from those accounts, and nothing is posted to them.
      </Section>

      <Section title="Cookies and analytics">
        A session token in your browser keeps you signed in. Page views are
        counted with{" "}
        <a
          href="https://vercel.com/docs/analytics/privacy-policy"
          className="underline"
        >
          Vercel Web Analytics
        </a>
        , which sets no cookies and does not track you across sites; it records
        the page, the referrer and a coarse device and country, never who you
        are or what you drew. There are no advertising trackers.
      </Section>

      <Section title="Deleting your data">
        Email the address below and your account, projects, drawings, interviews
        and prompts will be deleted.
      </Section>

      <Section title="Contact">
        Questions about this policy:{" "}
        <a href="mailto:ahmdmus19@gmail.com" className="underline">
          ahmdmus19@gmail.com
        </a>
        .
      </Section>
    </main>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 text-muted-foreground">{children}</p>
    </section>
  )
}
