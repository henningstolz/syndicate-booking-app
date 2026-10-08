import type { Metadata } from "next";
import Link from "next/link";
import { Eyebrow } from "../_components/Eyebrow";
import { Footer } from "../_components/Footer";

export const metadata: Metadata = {
  title: "Privacy: Blocktime",
  description:
    "What Blocktime stores about you, who can see it, and how to have it corrected or deleted.",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <h2 className="mb-3.5 text-[26px] leading-[1.2] font-bold tracking-[-0.01em]">
        {title}
      </h2>
      <div className="space-y-3.5 text-bt-muted [&_li]:mt-2 [&_strong]:font-semibold [&_strong]:text-bt-ink [&_ul]:list-disc [&_ul]:pl-6">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <header className="border-b border-bt-line bg-white">
        <div className="mx-auto flex max-w-[1160px] items-center justify-between gap-4 px-6 py-[18px]">
          <Link
            href="/"
            className="font-mono text-xl font-semibold tracking-[0.01em] no-underline"
          >
            blocktime<span className="font-normal text-bt-muted">.group</span>
          </Link>
          <Link
            href="/login"
            className="flex min-h-11 items-center text-[15px] hover:underline"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] px-6 pt-16 pb-20">
        <Eyebrow>PRIVACY</Eyebrow>
        <h1 className="mb-5 text-[clamp(34px,4.6vw,52px)] leading-[1.06] font-bold tracking-[-0.02em]">
          What Blocktime stores about you.
        </h1>
        <p className="text-[19px] text-bt-muted">
          Blocktime is a booking tool for small groups sharing an aircraft. It
          stores only what it needs to do that, shows it only to the other
          members of your group, and does not sell it, advertise with it or
          track you around the web.
        </p>
        <p className="mt-4 font-mono text-[13px] text-bt-muted">
          Last updated 8 October 2026
        </p>

        <Section title="Who is responsible">
          <p>
            Blocktime is run by Henning Stolz, United Kingdom, who decides how your data
            is used and is responsible for it under UK data protection law. To
            ask a question or use any of the rights below, write to{" "}
            <a
              href="mailto:hello@blocktime.group"
              className="text-bt-ink underline underline-offset-4 hover:text-bt-blue"
            >
              hello@blocktime.group
            </a>
            .
          </p>
        </Section>

        <Section title="What is stored">
          <ul>
            <li>
              <strong>Your account:</strong> your email address and a password.
              The password is stored scrambled (hashed) by our sign-in
              provider, so nobody, including the person running Blocktime, can
              read it.
            </li>
            <li>
              <strong>Your name in the group:</strong> the display name you
              enter when you join a group. Other members of that group see it
              on bookings, flight log entries and chat messages.
            </li>
            <li>
              <strong>What your group records:</strong> the aircraft details
              and due dates, bookings (times, notes and who made them), the
              flight log (for each flight: the captain&apos;s name, where it
              went, times, fuel, oil and any defect noted, and who entered
              it), messages in the group&apos;s chat, and the invitations an
              admin has created.
            </li>
            <li>
              <strong>Costs:</strong> the group&apos;s monthly share and hourly
              rate, any individual rates an admin sets for a member, expenses a
              member paid for the group (such as fuel bought away from home)
              that admins enter, and each member&apos;s monthly statement,
              worked out from the flight log.
            </li>
            <li>
              <strong>Your email choices:</strong> which emails you want from
              each group (for example about new bookings), and a queue of the
              emails still to be sent to you.
            </li>
            <li>
              <strong>Technical data:</strong> like any website, the hosting
              provider sees your IP address and browser type when you load a
              page, and keeps short-lived server logs to keep the service
              running and secure.
            </li>
          </ul>
          <p>
            Blocktime does not collect payment details, location, contacts or
            anything from your device beyond the above.
          </p>
        </Section>

        <Section title="Who can see it">
          <ul>
            <li>
              <strong>Your group:</strong> every member of a group can see that
              group&apos;s aircraft, bookings, flight log, chat and member
              names.
              Each member sees only their own cost statement, plus the month&apos;s
              totals; admins see everyone&apos;s. Group admins can also create
              invitations. Other groups cannot see
              any of it; this is enforced in the database itself, not just in
              the pages you see.
            </li>
            <li>
              <strong>The person running Blocktime</strong> can technically
              access the database in order to run, fix and secure the service.
              Your data is not read for any other purpose.
            </li>
            <li>
              <strong>The services listed below,</strong> only as far as they
              need it to do their job.
            </li>
          </ul>
          <p>Your data is never sold or shared for advertising.</p>
        </Section>

        <Section title="Services that handle data for Blocktime">
          <ul>
            <li>
              <strong>Supabase</strong> stores the database and handles
              sign-in. Data is held in London, United Kingdom.
            </li>
            <li>
              <strong>Vercel</strong> hosts the website and sees ordinary
              request data such as IP addresses.
            </li>
            <li>
              <strong>Resend</strong> sends the sign-up confirmation and
              password-reset emails, and the notification and reminder emails you choose
              in Settings, so it sees the recipient&apos;s email address and
              the message.
            </li>
            <li>
              <strong>GitHub</strong> holds a private, encrypted nightly copy
              of the database as a backup. Without the owner&apos;s passphrase
              the copy cannot be read.
            </li>
            <li>
              <strong>ImprovMX</strong> forwards mail sent to
              hello@blocktime.group to the owner&apos;s inbox.
            </li>
          </ul>
          <p>
            Some of these companies are based in, or may process data in, the
            United States. They rely on recognised safeguards for transfers
            outside the UK, such as the UK addendum to standard contractual
            clauses or the UK&ndash;US data bridge.
          </p>
        </Section>

        <Section title="Cookies">
          <p>
            Blocktime sets only the cookies needed to keep you signed in. They
            are essential to the service, which is why there is no cookie
            banner. There are no advertising or analytics cookies, and no
            third-party trackers.
          </p>
          <p>
            If you try the demo, one more small cookie keeps the changes you
            make in it (a booking, a message) on your own device, so they
            survive a page reload. It is only sent to the demo pages, it
            expires after a day, and the demo uses made-up data and does not
            touch our database.
          </p>
        </Section>

        <Section title="How long it is kept">
          <p>
            Your data is kept while your group uses Blocktime. Cancelled
            bookings are marked as cancelled rather than erased, so the
            group&apos;s history stays accurate. If you leave a group, or want
            your account removed, write to the address above and it will be
            deleted or anonymised, except where a group&apos;s records need to
            stay readable for the other members. Encrypted backups of the whole
            database are kept for up to a year (the last 30 days, then one a
            month), so something deleted can remain in an old backup until that
            backup expires.
          </p>
          <p>
            Notification emails are removed from the sending queue after at
            most a month (unsent ones after a week). You choose which emails
            you get under Settings, then Notifications, and every email links
            back there.
          </p>
        </Section>

        <Section title="Your rights">
          <p>Under UK data protection law you can ask to:</p>
          <ul>
            <li>see the personal data held about you,</li>
            <li>have it corrected, or deleted,</li>
            <li>
              object to, or ask for limits on, how it is used, and receive a
              copy in a portable format.
            </li>
          </ul>
          <p>
            Email{" "}
            <a
              href="mailto:hello@blocktime.group"
              className="text-bt-ink underline underline-offset-4 hover:text-bt-blue"
            >
              hello@blocktime.group
            </a>{" "}
            and you will get an answer within one month. If you are not
            satisfied, you can complain to the Information Commissioner&apos;s
            Office at{" "}
            <a
              href="https://ico.org.uk/make-a-complaint/"
              className="text-bt-ink underline underline-offset-4 hover:text-bt-blue"
            >
              ico.org.uk
            </a>
            .
          </p>
          <p>
            The legal basis for holding your data is that it is needed to
            provide the service you signed up for, and, for server logs and
            security, the legitimate interest of keeping the service safe.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            If this page changes in a way that matters, the date at the top
            will change and members will be told by email.
          </p>
        </Section>
      </main>

      <Footer />
    </>
  );
}
