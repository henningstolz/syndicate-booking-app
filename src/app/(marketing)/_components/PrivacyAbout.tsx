import { Eyebrow } from "./Eyebrow";

const heading =
  "mb-[18px] text-[clamp(28px,3.2vw,36px)] leading-[1.12] font-bold tracking-[-0.015em]";

export function PrivacyAbout() {
  return (
    <section className="border-t border-bt-line bg-white">
      <div className="mx-auto flex max-w-[1160px] flex-wrap gap-14 px-6 py-20">
        <div className="min-w-0 flex-[1_1_360px]">
          <Eyebrow>PRIVATE BY DESIGN</Eyebrow>
          <h2 className={heading}>Your group&apos;s data stays your group&apos;s.</h2>
          <p className="text-bt-muted">
            Each group has its own aircraft, members, bookings and squawks, and
            other groups cannot see them. Everyone signs in with their own
            email and password.
          </p>
        </div>
        <div className="min-w-0 flex-[1_1_360px]">
          <Eyebrow>WHO BUILT IT</Eyebrow>
          <h2 className={heading}>Built by a group member, for groups.</h2>
          <p className="text-bt-muted">
            Blocktime started inside a UK flying group, built by one of its
            members who wanted something better than the old booking site. It
            is made for small groups sharing an aircraft, not for flight
            schools.
          </p>
        </div>
      </div>
    </section>
  );
}
