import Link from "next/link";
import { GENERAL_EMAIL, PRIVACY_VERSION, SUPPORT_EMAIL } from "@/lib/legal";
import { LegalSection, LegalShell, MailLink, Review } from "../_components/Legal";

// The new privacy text (a DRAFT: unchecked statements carry a [REVIEW] note). It replaces PrivacyCurrent
// only where the legal switch (LEGAL_DOCS_LIVE=1) is on; see page.tsx.
export default function PrivacyDraft() {
  return (
    <LegalShell
      eyebrow="PRIVACY"
      title="What Blocktime stores about you."
      intro="Blocktime is a booking tool for small groups sharing an aircraft. It stores only what it needs to do that, shows it only to the other members of your group, and does not sell it, advertise with it or track you around the web."
      version={PRIVACY_VERSION}
    >
      <LegalSection title="Who is responsible">
        <p>
          Blocktime is run by HSBI Ltd, Terminal E2, Farnborough Airport, Farnborough, Hampshire GU14 6XA, United
          Kingdom. <Review>add the company registration number and confirm this is the registered office</Review>
        </p>
        <p>
          For your <strong>account</strong> (your email address, password and name) we decide how the data is used and are
          responsible for it under UK data protection law. For the <strong>records a group keeps</strong> (bookings, tech
          log, costs, chat and documents) the group decides what is recorded and we handle it on the group&apos;s behalf.{" "}
          <Review>confirm this split between controller and processor with legal advice</Review>
        </p>
        <p>
          To ask a question or use any of the rights below, write to <MailLink address={SUPPORT_EMAIL} />.
        </p>
      </LegalSection>

      <LegalSection title="What is stored">
        <ul>
          <li>
            <strong>Your account:</strong> your email address and a password. The password is stored scrambled (hashed) by our
            sign-in provider, so nobody, including the person running Blocktime, can read it.
          </li>
          <li>
            <strong>Your name in the group:</strong> the display name you enter when you join a group. Other members of that
            group see it on bookings, flight log entries and chat messages.
          </li>
          <li>
            <strong>What your group records:</strong> the aircraft details and due dates, bookings (times, notes and who
            made them), the flight log (for each flight: the captain&apos;s name, where it went, times, fuel, oil and any
            defect noted, and who entered it), messages in the group&apos;s chat, the files members upload under Documents
            (and receipts attached to expenses), and the invitations an admin has created. Uploaded files are kept in
            private storage in the same London data centre as the database; only members of the group can open them, and
            the uploader or an admin can delete them.
          </li>
          <li>
            <strong>Costs:</strong> the group&apos;s monthly share and hourly rate, any individual rates an admin sets for a
            member, expenses a member paid for the group, each member&apos;s monthly statement worked out from the flight log,
            a saved copy of each statement for any month an admin has closed, and the payments admins record against them.
          </li>
          <li>
            <strong>Your plan:</strong> which plan the group is on (for example &ldquo;founding group&rdquo;) and, later, its billing
            dates, and a history of changes to it.
          </li>
          <li>
            <strong>Your agreement to these texts:</strong> which version of the terms and of this page you accepted, and when
            (and for which group, if you accepted while creating one). No IP address is stored with it.
          </li>
          <li>
            <strong>Your email choices:</strong> which emails you want from each group (for example about new bookings), and a
            queue of the emails still to be sent to you.
          </li>
          <li>
            <strong>Messages you send us:</strong> if you use the Feedback button, your message, your name, your email address,
            the page you were on and your device type. It is emailed to our support address and a copy is kept so it can be
            followed up; ask for it to be deleted at any time.
          </li>
          <li>
            <strong>Your calendar link:</strong> if you create one under Account, a secret web address that shows your
            group&apos;s bookings (times, who booked, notes) to whoever has it. You can replace or switch it off at any time. If
            you add it to a calendar app, that calendar provider fetches and keeps a copy of those bookings under its own terms.
          </li>
          <li>
            <strong>Technical data:</strong> like any website, the hosting provider sees your IP address and browser type when
            you load a page, and keeps short-lived server logs to keep the service running and secure. If something breaks, an
            error report is sent to our error monitoring service. It holds the technical details of the fault and the type of
            browser or device; names, email addresses, what you typed, cookies and secret links are removed before it is sent.
          </li>
          <li>
            <strong>Exports:</strong> when a group admin downloads the group&apos;s data, we note which group, who and when. The
            contents of the download are not kept.
          </li>
        </ul>
        <p>Blocktime does not collect payment details, location, contacts or anything from your device beyond the above.</p>
      </LegalSection>

      <LegalSection title="Who can see it">
        <ul>
          <li>
            <strong>Your group:</strong> every member of a group can see that group&apos;s aircraft, bookings, flight log, chat and
            member names. Each member sees only their own cost statement, plus the month&apos;s totals; admins see everyone&apos;s.
            Other groups cannot see any of it; this is enforced in the database itself, not just in the pages you see.
          </li>
          <li>
            <strong>The person running Blocktime</strong> uses an admin page, protected by a second sign-in step, that shows for
            each group its name, the number of members, the group admins&apos; names and email addresses, its plan and when it was
            last used. It does not show bookings, flight logs or costs. The owner can technically access the database in order
            to run, fix and secure the service; your data is not read for any other purpose.
          </li>
          <li>
            <strong>The services listed below,</strong> only as far as they need it to do their job.
          </li>
        </ul>
        <p>Your data is never sold or shared for advertising.</p>
      </LegalSection>

      <LegalSection title="Services that handle data for Blocktime">
        <ul>
          <li><strong>Supabase</strong> stores the database and the uploaded files and handles sign-in. Data is held in London, United Kingdom.</li>
          <li><strong>Vercel</strong> hosts the website and sees ordinary request data such as IP addresses.</li>
          <li>
            <strong>Resend</strong> sends the sign-up confirmation and password-reset emails, and the notification and reminder
            emails you choose, so it sees the recipient&apos;s email address and the message. When an admin closes a month, that
            includes your cost statement for it, as a PDF attachment. We use its EU region.
          </li>
          <li>
            <strong>Sentry</strong> receives the error reports described above, so faults can be found and fixed. Reports are held
            in the European Union and kept for a short time.
          </li>
          <li>
            <strong>GitHub</strong> holds a private, encrypted nightly copy of the database and the uploaded files as a backup.
            Without the owner&apos;s passphrase the copy cannot be read.
          </li>
          <li>
            <strong>ImprovMX</strong> forwards mail sent to {SUPPORT_EMAIL} and {GENERAL_EMAIL} to the owner&apos;s inbox.
          </li>
          <li>
            <strong>UptimeRobot</strong> checks every few minutes that the website is up, by asking a public page that shows no
            personal data.
          </li>
        </ul>
        <p>
          Some of these companies are based in, or may process data in, the United States. They rely on recognised safeguards
          for transfers outside the UK, such as the UK addendum to standard contractual clauses or the UK&ndash;US data bridge.{" "}
          <Review>check each provider&apos;s current transfer mechanism and the regions used</Review>
        </p>
      </LegalSection>

      <LegalSection title="Cookies">
        <p>
          Blocktime sets only the cookies needed to keep you signed in. They are essential to the service, which is why there is
          no cookie banner. There are no advertising or analytics cookies, and no third-party trackers.
        </p>
        <p>
          If you try the demo, one more small cookie keeps the changes you make in it on your own device, so they survive a page
          reload. It is only sent to the demo pages, it expires after a day, and the demo uses made-up data and does not touch
          our database.
        </p>
      </LegalSection>

      <LegalSection title="How long it is kept, and getting your data out">
        <p>
          Your data is kept while your group uses Blocktime. Cancelled bookings are marked as cancelled rather than erased, so
          the group&apos;s history stays accurate. A group&apos;s admins can download all of the group&apos;s records at any time, as a
          set of spreadsheet files, under Settings, Export your data.
        </p>
        <p>
          <strong>Deleting a group:</strong> a group&apos;s admin can ask us, at <MailLink address={SUPPORT_EMAIL} />, to delete
          the group. We confirm the request, send an export first, and delete the group, its members&apos; records in it and its
          uploaded files, normally within one month. <strong>Leaving or removing your account:</strong> write to us and your account
          will be deleted or anonymised, except where a group&apos;s records need to stay readable for the other members.
        </p>
        <p>
          Encrypted backups of the whole database are kept for up to a year (the last 30 days, then one a month), so something
          deleted can remain in an old backup until that backup expires. The same applies to uploaded files. A short history of
          changes to a group&apos;s plan is kept after a group is deleted; it holds only internal ids and plan details, no names or
          email addresses. <Review>check these retention periods are what you want to promise</Review>
        </p>
        <p>
          Notification emails are removed from the sending queue after at most a month (unsent ones after a week). You choose
          which emails you get under Account, then Notifications, and every email links back there.
        </p>
      </LegalSection>

      <LegalSection title="Your rights">
        <p>Under UK data protection law you can ask to:</p>
        <ul>
          <li>see the personal data held about you,</li>
          <li>have it corrected, or deleted,</li>
          <li>object to, or ask for limits on, how it is used, and receive a copy in a portable format.</li>
        </ul>
        <p>
          Email <MailLink address={SUPPORT_EMAIL} /> and you will get an answer within one month. If you are not satisfied, you can
          complain to the Information Commissioner&apos;s Office at{" "}
          <a href="https://ico.org.uk/make-a-complaint/" className="text-bt-ink underline underline-offset-4 hover:text-bt-blue">
            ico.org.uk
          </a>
          .
        </p>
        <p>
          The legal basis for holding your data is that it is needed to provide the service you signed up for, and, for server logs,
          error reports and security, the legitimate interest of keeping the service safe.{" "}
          <Review>confirm the legal bases</Review>
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          If this page changes in a way that matters, the version at the top changes and everyone is asked to accept the new
          version the next time they use Blocktime. See also the{" "}
          <Link href="/terms" className="text-bt-ink underline underline-offset-4 hover:text-bt-blue">Terms</Link>.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
