import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  CheckCircle2,
  EyeOff,
  FileText,
  Gauge,
  Lock,
  Scale,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { request } from '../lib/api';
import { Badge, Card } from '../components/ui';

interface Meta {
  stats: { openJobs: number; organisations: number; candidates: number; biasReports: number };
}

export default function Landing() {
  const { data } = useQuery({
    queryKey: ['public', 'meta'],
    queryFn: () => request<Meta>('/public/meta'),
  });

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-forest-800 text-white">
        <div className="absolute inset-0 opacity-[0.14]" aria-hidden="true">
          <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-zinc-700 blur-3xl" />
          <div className="absolute right-0 top-40 h-96 w-96 rounded-full bg-zinc-600 blur-3xl" />
          <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
                <path d="M 48 0 L 0 0 0 48" fill="none" stroke="white" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.1fr,0.9fr] lg:items-center">
          <div>
            <Badge className="border-white/25 bg-white/10 text-white">Yoruba for “work”</Badge>
            <h1 className="mt-5 max-w-2xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
              Graduate hiring that is <span className="text-white underline decoration-zinc-500">fast</span>, explainable and{' '}
              <span className="text-white underline decoration-zinc-500">fair</span>.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-zinc-300 sm:text-lg">
              Iṣẹ́ helps Nigerian employers screen graduate CVs against real criteria, shows the reasoning behind every score,
              hides identity during shortlisting, and audits the whole pipeline for bias — in plain language.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/register"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200"
              >
                Start hiring fairly <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-xl border border-white/30 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Sign in
              </Link>
            </div>
            <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-white/15 pt-6 text-sm">
              <div>
                <dt className="text-forest-200">Open roles</dt>
                <dd className="mt-1 text-2xl font-semibold">{data?.stats.openJobs ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-forest-200">Organisations</dt>
                <dd className="mt-1 text-2xl font-semibold">{data?.stats.organisations ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-forest-200">Bias reports</dt>
                <dd className="mt-1 text-2xl font-semibold">{data?.stats.biasReports ?? '—'}</dd>
              </div>
            </dl>
          </div>

          <Card className="border-0 bg-white/95 p-5 text-ink shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <p className="text-sm font-semibold">Bias audit · live snapshot</p>
              <Badge tone="warn">2 flags</Badge>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-start gap-3 rounded-xl border border-stone-300 bg-stone-100 p-3">
                <Scale className="mt-0.5 h-4 w-4 shrink-0 text-stone-700" aria-hidden="true" />
                <p className="text-ink">
                  <strong>Selection rate:</strong> polytechnic graduates advanced at 62% of the highest group’s rate — below the
                  four-fifths threshold.
                </p>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-forest-200 bg-forest-50 p-3">
                <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-forest-700" aria-hidden="true" />
                <p className="text-forest-900">
                  <strong>Blind screening on:</strong> names, gender, age, state of origin and university names are hidden
                  before a human reviews the CV.
                </p>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-line bg-stone-50 p-3">
                <Users className="mt-0.5 h-4 w-4 shrink-0 text-ink/70" aria-hidden="true" />
                <p className="text-ink/80">
                  <strong>Human in the loop:</strong> every shortlist and rejection records the person and their written reason.
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted">
              <div className="rounded-lg border border-line p-2">
                <p className="font-medium text-ink">Selection rate</p>
                <p>Federal 71% · State 66%</p>
              </div>
              <div className="rounded-lg border border-line p-2">
                <p className="font-medium text-ink">Small groups</p>
                <p>Suppressed under 5 people</p>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              Illustrative figures. Statistical flags indicate possible bias and require human investigation — they are not legal
              findings.
            </p>
          </Card>
        </div>
      </section>

      {/* Fairness promise */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-gold-600">Our fairness promise</p>
          <h2 className="mt-2 text-3xl font-semibold sm:text-4xl">AI recommends. A person decides. Every time.</h2>
          <p className="mt-3 text-muted">
            Iṣẹ́ is designed around a simple rule: an algorithm may help you read 150 CVs, but it may never reject someone for
            you. Identity signals stay out of the score and out of the shortlist.
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: EyeOff, title: 'Blind by default', text: 'Names, photos, gender, age, origin, marital status and university names are redacted until shortlisting.' },
            { icon: FileText, title: 'Plain explanations', text: 'Each score lists the criteria met and missed, with the model and prompt version stored.' },
            { icon: BarChart3, title: 'Built-in audit', text: 'Four-fifths rule, proxy detection, counterfactual tests and override analysis on real pipeline data.' },
            { icon: Lock, title: 'Demographics sealed', text: 'Voluntary self-declarations are encrypted separately and never shown to recruiters or the scorer.' },
          ].map((item) => (
            <Card key={item.title} className="p-5">
              <item.icon className="h-6 w-6 text-forest-700" aria-hidden="true" />
              <h3 className="mt-3 text-base font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.text}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-line bg-white/60">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-3xl font-semibold">How Iṣẹ́ works</h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            {[
              {
                icon: Gauge,
                title: 'Set the job, not a hunch',
                text: 'Build weighted, job-related criteria and knockout questions. Must-haves and nice-to-haves are explicit and editable.',
              },
              {
                icon: Sparkles,
                title: 'Screen with evidence',
                text: 'CVs are parsed into structured facts, then scored against your rubric at temperature zero, with a written explanation and stored prompt version.',
              },
              {
                icon: ShieldCheck,
                title: 'Audit the outcome',
                text: 'See selection rates by group, adverse impact, proxy signals, counterfactual score gaps and one-sided overrides — then export a PDF report.',
              },
            ].map((step, index) => (
              <li key={step.title} className="relative">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-forest-600 text-sm font-semibold text-white">
                    {index + 1}
                  </span>
                  <step.icon className="h-5 w-5 text-gold-600" aria-hidden="true" />
                </div>
                <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Nigeria-specific risks */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[0.9fr,1.1fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-gold-600">Built for Nigeria</p>
            <h2 className="mt-2 text-3xl font-semibold">The local hiring risks, handled explicitly</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Generic screening tools miss the patterns that matter here. Iṣẹ́ is designed around them — and documents what it
              does about each one.
            </p>
            <Link to="/ai-use" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-forest-700 hover:underline">
              Read the AI &amp; fairness statement <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <ul className="space-y-3">
            {[
              ['Ethnic and state-of-origin signals in names', 'Names are never sent to the scorer and are hidden in blind mode; counterfactual testing swaps names to prove it.'],
              ['Polytechnic vs university prejudice', 'HND and BSc are compared by level, not prestige. The audit flags institution type as a possible proxy.'],
              ['Private vs public university prestige', 'Institution prestige is excluded from scoring. The optional demo rule exists only to show the audit catching it.'],
              ['Marital status and gender questions', 'Not collected for screening. They are removed from blind views and never reach the score.'],
              ['CV-format advantage', 'Structured parsing normalises messy formats; CV length is tracked as a proxy feature in the audit.'],
            ].map(([title, text]) => (
              <li key={title} className="flex gap-3 rounded-xl border border-line bg-white p-4">
                <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-forest-600" aria-hidden="true" />
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="rounded-3xl bg-forest-800 px-6 py-12 text-center text-white sm:px-12">
          <ShieldCheck className="mx-auto h-8 w-8 text-white" aria-hidden="true" />
          <h2 className="mt-4 text-3xl font-semibold">Hire graduates on evidence, not pedigree.</h2>
          <p className="mx-auto mt-3 max-w-2xl text-zinc-300">
            Post a role, screen fairly, shortlist with a human decision, and walk into your next audit with a report you can
            defend.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link to="/register" className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-zinc-950 hover:bg-zinc-200">
              Create a recruiter account
            </Link>
            <Link to="/register?role=candidate" className="rounded-xl border border-white/30 px-5 py-3 text-sm font-semibold hover:bg-white/10">
              I am looking for work
            </Link>
          </div>
          <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-zinc-400">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" /> NDPA 2023 principles · encrypted demographics · retention limits
          </p>
        </div>
      </section>

      <section className="border-t border-line bg-white/60">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:grid-cols-3 sm:px-6">
          {[
            { icon: CheckCircle2, text: 'Candidates can request human review of any AI-assisted decision.' },
            { icon: CheckCircle2, text: 'Every override requires a written reason and is logged immutably.' },
            { icon: CheckCircle2, text: 'Reports always include methodology notes and sample-size warnings.' },
          ].map((item) => (
            <p key={item.text} className="flex gap-2 text-sm text-muted">
              <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-forest-600" aria-hidden="true" />
              {item.text}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}
