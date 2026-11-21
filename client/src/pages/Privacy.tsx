import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Database, EyeOff, Lock, ShieldCheck, Trash2, UserCheck } from 'lucide-react';
import { Card } from '../components/ui';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold text-forest-800">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-ink/85">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-widest text-gold-600">Trust</p>
      <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Privacy notice</h1>
      <p className="mt-2 text-sm text-muted">Version 2026-02-v1 · Written for the Nigeria Data Protection Act (NDPA) 2023</p>

      <Card className="mt-6 border-forest-200 bg-forest-50/70 p-5">
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-forest-700" aria-hidden="true" />
          <div className="text-sm leading-relaxed text-forest-950">
            <p className="font-semibold">The short version</p>
            <p className="mt-1">
              We collect what is needed to assess your application and run fairness audits. Sensitive demographic data is
              voluntary, encrypted separately and never shown to recruiters at an individual level. You can access, correct and
              delete your data, and you can ask for a human review at any time.
            </p>
          </div>
        </div>
      </Card>

      <Section title="Who is responsible for your data">
        <p>
          When you apply for a job, the recruiting organisation is the data controller for your application. Iṣẹ́ acts as a data
          processor providing screening, scheduling and audit tooling. Platform-level queries can go to the administrator of
          the Iṣẹ́ deployment you are using.
        </p>
      </Section>

      <Section title="What we collect and why">
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Account data:</strong> name, email, phone, password hash. Purpose: authentication and communication.</li>
          <li><strong>Application data:</strong> CV file, parsed CV facts, cover letter, knockout answers, interview availability. Purpose: assessing your application.</li>
          <li><strong>Screening data:</strong> AI scores, per-criterion explanations, model and prompt version, and human decisions. Purpose: explainability and audit.</li>
          <li>
            <strong>Voluntary demographics:</strong> gender, age band, state of origin, university type, disability status.
            Purpose: aggregate bias auditing only. Stored AES-256-GCM encrypted in a separate table. Never used in scoring and
            never shown per candidate to recruiters.
          </li>
          <li><strong>Technical data:</strong> IP address and user agent for security, rate limiting and the audit trail.</li>
        </ul>
      </Section>

      <Section title="Lawful basis and consent">
        <p>
          Application processing relies on the steps needed to enter an employment relationship and the employer’s legitimate
          interest in fair, auditable selection. Demographic analysis relies on your explicit, separate consent, which you may
          withdraw at any time without affecting your application. Withdrawing removes you from group statistics.
        </p>
      </Section>

      <Section title="AI-assisted screening">
        <p>
          AI produces a score and a written explanation against the job’s published criteria. It never rejects you. A human
          recruiter reviews and decides, and every rejection or override requires a written reason. See the{' '}
          <Link to="/ai-use" className="font-medium text-forest-700 underline">
            AI use &amp; fairness statement
          </Link>
          .
        </p>
      </Section>

      <Section title="Data minimisation, retention and security">
        <p>
          CV contents and demographic payloads are not written to application logs. Files are held in encrypted storage
          (AES-256 server-side encryption for S3-compatible storage) and access is restricted per organisation. A configurable
          retention period (default 365 days) purges CV files and parsed personal data from closed applications. Audit logs,
          which record decisions but not CV contents, are retained to meet accountability obligations.
        </p>
        <p>
          Access is role-based. Blind screening hides identity signals before a recruiter sees an application. Revealing
          identity is an explicit, logged action available only after shortlisting.
        </p>
      </Section>

      <Section title="Your rights under the NDPA 2023">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { icon: Database, title: 'Access & portability', text: 'Download a JSON copy of your account, applications, parsed CV data and declarations from Profile → Privacy.' },
            { icon: UserCheck, title: 'Correction', text: 'Correct parsed CV details before or after applying; the score is recomputed and the correction logged.' },
            { icon: Trash2, title: 'Deletion', text: 'Request erasure from Profile → Privacy. Personal data is removed after human review; decision records remain anonymised.' },
            { icon: EyeOff, title: 'Objection & human review', text: 'Ask for human review of any AI-assisted decision from your application page.' },
          ].map((right) => (
            <div key={right.title} className="rounded-xl border border-line bg-white p-4">
              <right.icon className="h-5 w-5 text-forest-700" aria-hidden="true" />
              <p className="mt-2 font-medium text-ink">{right.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{right.text}</p>
            </div>
          ))}
        </div>
        <p className="mt-3">
          You may also lodge a complaint with the Nigeria Data Protection Commission (NDPC). We will respond to rights requests
          within the timelines set by the NDPA.
        </p>
      </Section>

      <Section title="International transfers and processors">
        <p>
          Depending on configuration, CV text may be sent to an AI model provider and messages to email/SMS gateways. Transfers
          are limited to what is needed for the stated purpose, and sensitive demographic data is never sent to the AI provider.
          Self-hosted deployments can disable AI providers entirely and use the deterministic rubric.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          For privacy requests, use the in-app data request tools so the request is logged and traceable. For other concerns,
          contact the administrator of this Iṣẹ́ deployment.
        </p>
      </Section>

      <Card className="mt-8 border-amber-200 bg-amber-50 p-5">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
          <p className="text-sm leading-relaxed text-amber-950">
            <strong>Important:</strong> this notice describes how the software is designed. Legal compliance with the NDPA 2023
            (including lawful basis, cross-border transfer mechanisms and retention policy) must be reviewed by a qualified
            Nigerian data-protection professional before production use. The repository includes this same caveat.
          </p>
        </div>
      </Card>

      <div className="mt-8 flex flex-wrap gap-3 text-sm">
        <Link to="/ai-use" className="rounded-xl border border-line bg-white px-4 py-2 font-medium text-forest-700 hover:bg-forest-50">
          AI use &amp; fairness statement
        </Link>
        <Link to="/register" className="rounded-xl bg-forest-600 px-4 py-2 font-medium text-white hover:bg-forest-700">
          Create an account
        </Link>
      </div>
    </div>
  );
}

export function AiUsePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-widest text-gold-600">Fairness</p>
      <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">AI use &amp; fairness statement</h1>
      <p className="mt-2 text-sm text-muted">What the AI does, what it must never do, and how we check.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { icon: CheckCircle2, title: 'Recommends', text: 'Produces an explained score and evidence summary.' },
          { icon: EyeOff, title: 'Never auto-rejects', text: 'Every final decision is made by a person, with a reason.' },
          { icon: Lock, title: 'Blind by default', text: 'Identity signals are removed before human review.' },
        ].map((item) => (
          <Card key={item.title} className="p-4">
            <item.icon className="h-5 w-5 text-forest-700" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold">{item.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{item.text}</p>
          </Card>
        ))}
      </div>

      <Section title="How a score is produced">
        <ol className="list-decimal space-y-2 pl-5">
          <li>The CV is parsed into structured facts (education, skills, experience, projects, certifications, languages).</li>
          <li>A deterministic rubric scores each weighted criterion with keyword and structured matching.</li>
          <li>When an LLM is configured, it independently reviews the anonymised evidence at temperature 0; its judgement is blended with the rubric.</li>
          <li>The total and a plain-language explanation are stored with the model name, prompt version and timestamp.</li>
          <li>A recruiter reviews the explanation and makes the decision. Overrides and rejections require a written reason.</li>
        </ol>
      </Section>

      <Section title="What is never scored">
        <p>
          Name, photograph, gender, age or date of birth, state of origin, religion, marital status and address are removed from
          the scoring input. University prestige is not scored: only whether the level and class meet the stated requirement.
          The real-time blind view also hides university names before shortlisting.
        </p>
      </Section>

      <Section title="Nigeria-specific safeguards">
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Names and ethnicity:</strong> counterfactual testing swaps Yoruba, Igbo, Hausa and gendered names while holding qualifications constant, and reports score differences.</li>
          <li><strong>Polytechnic prejudice:</strong> HND is compared on level and class, not institution prestige. The bias audit treats institution type as a group dimension and a possible proxy.</li>
          <li><strong>Private vs public universities:</strong> excluded from scoring; the demo bias rule exists solely to demonstrate the audit catching a pedigree preference.</li>
          <li><strong>Marital and gender questions:</strong> not collected for screening and removed from blind CV views.</li>
          <li><strong>CV-format advantage:</strong> parsing normalises layout differences; CV word count is tracked as a proxy feature.</li>
        </ul>
      </Section>

      <Section title="Audit method, in plain language">
        <p>
          For each stage we compare how often each group advances. A group advancing below 80% of the highest group’s rate is
          flagged (the four-fifths rule). Groups under five people are suppressed so no individual can be identified. We also
          test whether CV features correlate with both group and score, whether human overrides favour one group, and whether
          swapping identity signals changes a score.
        </p>
        <p>
          These are statistical signals, not legal findings. A flag means “investigate this”, with the reasons and methodology
          written in the exported report.
        </p>
      </Section>

      <Card className="mt-8 border-forest-200 bg-forest-50 p-5 text-sm leading-relaxed text-forest-950">
        <p className="font-semibold">Your right to a human review</p>
        <p className="mt-1">
          If AI assisted a decision about you, you can request human review from your application page at any time. The
          recruiter is notified, the request is logged, and your application is reviewed manually.
        </p>
      </Card>
    </div>
  );
}
