import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { legalDocsLive, SUPPORT_EMAIL, TERMS_VERSION } from "@/lib/legal";
import { LegalSection, LegalShell, MailLink, Review } from "../_components/Legal";

export const metadata: Metadata = {
  title: "Terms of use: Blocktime",
  description: "The terms for using Blocktime: what it is, what it is not, and who is responsible for what.",
};

// A DRAFT. Every statement that has not been checked carries a [REVIEW] note. The page exists only where
// the legal switch (LEGAL_DOCS_LIVE=1) is on; everywhere else it is a plain 404.
export default function TermsPage() {
  if (!legalDocsLive()) notFound();

  return (
    <LegalShell
      eyebrow="TERMS"
      title="Terms of use."
      intro="These are the terms for using Blocktime. They are short on purpose. If anything is unclear, write to us before you accept."
      version={TERMS_VERSION}
    >
      <LegalSection title="Who we are">
        <p>
          Blocktime is run by Henning Stolz, United Kingdom.{" "}
          <Review>full legal name or company name and registered address to be filled in</Review> You can reach us at{" "}
          <MailLink address={SUPPORT_EMAIL} />.
        </p>
      </LegalSection>

      <LegalSection title="What Blocktime is, and is not">
        <p>
          Blocktime is a scheduling and record-keeping tool for groups that share an aircraft: a booking calendar, a
          tech log with the aircraft&apos;s due dates, and a way to share costs.
        </p>
        <p>
          <strong>It is a convenience, not an authoritative source.</strong> It is not a source for flight planning, for
          airworthiness or for maintenance status. The pilot in command and the aircraft&apos;s owners or operators stay
          responsible for those, for the records the law requires, and for checking anything Blocktime shows.{" "}
          <Review>wording to be checked by someone who knows aviation regulation</Review>
        </p>
      </LegalSection>

      <LegalSection title="Free during the beta">
        <p>
          Blocktime is free to use while it is in beta. We will give at least 60 days&apos; notice, by email to the group
          admins, before charging for anything, and nothing is charged without your agreement.{" "}
          <Review>confirm the notice period and the wording about charging</Review>
        </p>
      </LegalSection>

      <LegalSection title="Accounts and groups">
        <p>
          Give accurate information and keep your password to yourself. A group&apos;s admins decide who is invited. An admin
          who creates or manages a group accepts these terms for the group and is responsible for the people they add.{" "}
          <Review>check that an admin can bind the group in this way</Review>
        </p>
        <p>Each group&apos;s information can be seen only by that group&apos;s members. Other groups cannot see it.</p>
      </LegalSection>

      <LegalSection title="Your information">
        <p>
          You and your group own what you put into Blocktime. We use it only to run the service, as set out on the{" "}
          <Link href="/privacy" className="text-bt-ink underline underline-offset-4 hover:text-bt-blue">Privacy page</Link>.
        </p>
        <p>
          You are responsible for it being accurate and for having the right to record it. A group&apos;s admins can
          download all of the group&apos;s records at any time, under Settings, Export your data.
        </p>
      </LegalSection>

      <LegalSection title="Using Blocktime properly">
        <ul>
          <li>Do not try to see another group&apos;s information or to get around the way the service protects it.</li>
          <li>Do not overload, attack or misuse the service.</li>
          <li>Do not put unlawful or harmful material in the chat or in uploaded documents.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Support and availability">
        <p>
          Support is by email and on a best-effort basis. We aim to keep Blocktime running but do not promise that it will
          always be available or free of errors. We make an encrypted backup every night, but you should keep your own copy
          of anything you cannot do without (the export helps with that).
        </p>
      </LegalSection>

      <LegalSection title="Our responsibility to you">
        <p>
          Nothing in these terms limits any liability that the law does not allow to be limited, such as for death or
          personal injury caused by negligence, or for fraud.
        </p>
        <p>
          Otherwise, as far as the law allows, we are not responsible for losses that come from relying on Blocktime as the
          only record for decisions about flying, maintenance or airworthiness, for indirect losses, or for loss of
          information that we did not cause by our own negligence. Our total responsibility to a group in any twelve
          months is limited to <Review>an amount to be agreed with a solicitor</Review>.{" "}
          <Review>this whole section needs a solicitor&apos;s review</Review>
        </p>
      </LegalSection>

      <LegalSection title="Ending your use">
        <p>
          You can stop using Blocktime at any time. A group&apos;s admins can ask us to delete the group: write to us, and we
          will send you an export first and then delete the group&apos;s information. We may suspend an account that is
          misused, with notice where that is reasonable. <Review>check the suspension wording</Review>
        </p>
      </LegalSection>

      <LegalSection title="Changes to these terms">
        <p>
          If we change these terms in a way that matters, the version at the top of this page changes and everyone is asked
          to accept the new version the next time they use Blocktime. Changes that affect charging follow the notice
          period above. <Review>decide how much notice other changes need</Review>
        </p>
      </LegalSection>

      <LegalSection title="Law">
        <p>
          These terms are governed by the law of England and Wales, and its courts have jurisdiction.{" "}
          <Review>confirm</Review>
        </p>
      </LegalSection>
    </LegalShell>
  );
}
