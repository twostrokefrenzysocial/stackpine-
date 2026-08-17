/* ============================================================
   BUILDS PAGE CONTENT: edit this file to change any copy on
   the Builds page. The page renders everything from this data;
   no component or markup changes needed to edit copy or add a
   project. No live links are used anywhere on this page.
   ============================================================ */

window.BUILDS_DATA = {

  hero: {
    eyebrow: "Builds",
    headline: "Systems that pay for themselves.",
    intro: "AI systems and software personally built with Claude and Claude Code, in my role at a behavioral health nonprofit and independently under Stackpine."
  },

  stats: [
    { num: "146", suffix: " hrs/week", label: "saved through AI and automation" },
    { num: "3.65", suffix: " FTE", label: "equivalent capacity added" },
    { num: "7,592", suffix: " hours", label: "recovered per year" },
    { num: "$227,760", suffix: "", label: "estimated annual efficiency value (at a $30/hr staff equivalency rate)" }
  ],

  statsFinePrint: "Figures are conservative, per-system estimates documented in board-level reporting at a behavioral health nonprofit where I designed and operate the full AI stack. A per-system breakdown is available on request.",

  attribution: {
    nonprofit: "Built in my role as Automations Supervisor & AI Architect at a behavioral health nonprofit.",
    independent: "Independent build under Stackpine."
  },

  /* category: "nonprofit" | "independent"
     demo: null, or one of "assistant-chat", "email-triage", "resume-scorer",
           "dashboard-mock", "dgx-diagram"
     interactive demos (shown by the Live Demos filter) are:
           assistant-chat, email-triage, resume-scorer */
  projects: [
    {
      id: "staff-knowledge-assistant",
      name: "Staff Knowledge Assistant",
      subtitle: "Internal RAG chatbot",
      category: "nonprofit",
      summary: "An internal AI assistant that answers staff policy and procedure questions from the organization's own documents.",
      problem: "Staff interrupted supervisors constantly for policy and procedure answers buried in documents.",
      what: "Internal AI assistant grounded in ingested organizational documents (PDF, DOCX, TXT) with OCR for scanned files, streaming answers, voice input, a feedback loop, per-document re-indexing, and honest-decline behavior when documents do not cover a question. Upgraded from document lookup to an operational reasoning advisor.",
      stack: ["Node/Express", "React/Vite PWA", "SQLite FTS5", "tesseract.js + pdfjs-dist OCR", "SSE streaming", "JWT auth", "Railway", "Automated daily Box backups"],
      impact: "Absorbs an estimated 30 hrs/week of procedural questions and supervisor interruptions.",
      demo: "assistant-chat"
    },
    {
      id: "email-triage-agent",
      name: "Email Triage Agent",
      subtitle: "Autonomous inbox management",
      category: "nonprofit",
      summary: "A persistent agent that sorts high-volume Outlook inboxes automatically and rescues legitimate mail from junk.",
      problem: "High-volume Outlook inboxes needed constant manual sorting, and legitimate contacts occasionally landed in junk unseen.",
      what: "Persistent Python agent that authenticates to Microsoft Graph (MSAL device-code flow, cached token), applies sender rules first, batch-classifies the rest with an LLM (Actionable, Automated, Spam), moves messages to the right folders, and rescues protected contacts from junk. Replicated across multiple staff inboxes from a reusable build prompt.",
      stack: ["Python", "Microsoft Graph API", "MSAL", "Anthropic API", "Local JSON classification cache", "Continuous polling service"],
      impact: "Cut triage of 50 emails from roughly 8 minutes to about 13 seconds.",
      demo: "email-triage"
    },
    {
      id: "resume-screening-pipeline",
      name: "Resume Screening Pipeline",
      subtitle: "Privacy-first candidate triage",
      category: "nonprofit",
      summary: "A privacy-first pipeline that scores resumes against a job description with a locally hosted LLM.",
      problem: "A large resume backlog plus a live stream of new applicants, with strict data privacy requirements.",
      what: "Pulls resumes from Google Drive, extracts text, scores each candidate against the job description on weighted dimensions (JD match, behavioral adaptability, AI/tech leverage) using a locally hosted LLM so no PII leaves the building, writes ranked results with rationale to Google Sheets, logs failures for review, and covers both a one-time backlog burn and an always-on watch folder. Framed as triage assist with human-in-the-loop review, never a hiring decision-maker.",
      stack: ["n8n", "Google Drive", "Google Sheets", "Ollama on on-prem hardware"],
      impact: null,
      demo: "resume-scorer"
    },
    {
      id: "ai-governance-policy-builder",
      name: "AI Governance Policy Builder",
      subtitle: "Policy generation web app",
      category: "nonprofit",
      summary: "A multi-step web form that generates a customized AI governance policy as a downloadable Word document.",
      problem: "Nonprofits at a statewide summit needed real AI governance policies, not templates.",
      what: "Multi-step web form that generates a customized AI governance policy as a downloadable Word document. Load-hardened for roughly 300 concurrent users (rate-limit backoff, mobile fixes, generation logging).",
      stack: ["React/Vite", "Vercel serverless", "Anthropic API", "docx generation"],
      impact: null,
      demo: null
    },
    {
      id: "on-prem-ai-server",
      name: "On-Prem AI Server",
      subtitle: "NVIDIA DGX Spark",
      category: "nonprofit",
      summary: "An on-premises inference layer that keeps compliance-sensitive AI workloads entirely in the building.",
      problem: "Compliance-sensitive workflows (intake, case-adjacent processing) cannot run on cloud LLMs.",
      what: "On-premises inference layer serving a large local model through an OpenAI-compatible endpoint, powering local document RAG, privacy-sensitive processing, and scheduled agent runs as persistent services.",
      stack: ["NVIDIA DGX Spark", "Ollama", "Nemotron Super 49B", "systemd services"],
      impact: null,
      demo: "dgx-diagram"
    },
    {
      id: "operational-dashboards",
      name: "Operational Dashboards",
      subtitle: "Role-specific live views",
      category: "nonprofit",
      summary: "Role-specific dashboards that replace manual status compilation across Outlook, Smartsheet, and internal trackers.",
      problem: "Leadership and program staff compiled status manually across Outlook, Smartsheet, and internal trackers.",
      what: "Role-specific dashboards with live task, fleet, grant, and communications views, plus email notifications sent through Microsoft Graph.",
      stack: ["React", "Node/Express", "SQLite", "Microsoft Graph API", "Smartsheet API", "Tailwind"],
      impact: "Estimated 15 hrs/week saved across roles.",
      demo: "dashboard-mock"
    },
    {
      id: "resident-budget-builder",
      name: "Resident Budget Builder",
      subtitle: "Private budgeting PWA",
      category: "nonprofit",
      summary: "A private, resident-facing budgeting tool built to accompany a financial literacy course.",
      problem: "Residents completing a financial literacy course needed a private, simple budgeting tool to take home.",
      what: "Resident-facing budgeting PWA built around zero-based budgeting, a starter emergency fund, and debt snowball tracking. Admin-provisioned credentials, no self-registration, and privacy by design: administrators cannot view resident financial data.",
      stack: ["Node/Express", "better-sqlite3", "Vanilla JS PWA", "pm2 on on-prem hardware", "Cloudflare Tunnel"],
      impact: null,
      demo: null
    },
    {
      id: "crm-automation-suite",
      name: "CRM Automation Suite",
      subtitle: "GoHighLevel",
      category: "nonprofit",
      summary: "Automated pipelines for intake, follow-up, and program communications.",
      problem: "Intake, follow-up, and program communications ran on manual effort.",
      what: "Automated pipelines for client intake and onboarding, staff notifications and task routing, client follow-up, document distribution, program transition workflows, Voice AI inbound handling, A2P 10DLC SMS compliance, and Stripe-backed event registration for a statewide summit.",
      stack: ["GoHighLevel", "Stripe", "A2P 10DLC"],
      impact: "Estimated 23 hrs/week saved across programs.",
      demo: null
    },
    {
      id: "nonprofit-website-migration",
      name: "Nonprofit Website Migration",
      subtitle: "WordPress to static",
      category: "nonprofit",
      summary: "A slow WordPress site rebuilt as a fast static site with documented handoff.",
      problem: "A slow WordPress site with contractor-dependent hosting.",
      what: "Rebuilt a 30+ page nonprofit website as a fast static site, deployed from GitHub with documented handoff for future maintainers.",
      stack: ["Static HTML/CSS/JS", "Railway", "GitHub", "Cloudflare DNS"],
      impact: null,
      demo: null
    },
    {
      id: "revlane-openthrottle",
      name: "RevLane / OpenThrottle",
      subtitle: "Revenue recovery SaaS",
      category: "independent",
      summary: "A SaaS platform that recovers declined-service revenue for auto and powersports shops.",
      problem: "Auto and powersports shops lose revenue when customers decline recommended service or walk out on a quote, and nobody follows up.",
      what: "SaaS platform that tracks declined services and walk-out leads and runs automated SMS follow-up to recover the revenue, with shop dashboards, admin tooling (impersonation, health-check watchdog, daily digests, trial and churn automation), and a performance-based pricing engine. Verified by a 56-test production suite.",
      stack: ["Node/Express", "React", "SQLite", "Railway", "Vercel", "Telnyx 10DLC with Ed25519 webhook signature verification", "Stripe", "Resend"],
      impact: null,
      demo: null
    },
    {
      id: "funeral-triage",
      name: "Funeral Triage",
      subtitle: "Dispatch coordination",
      category: "independent",
      summary: "A dispatch app built for a funeral services client, in active paid use.",
      problem: "A direct-to-families funeral service needed structured dispatch coordination.",
      what: "Dispatch app built for a funeral services client, in active paid use.",
      stack: null,
      stackTodo: "TODO: stack details to be confirmed before publishing this card's stack line.",
      impact: null,
      demo: null
    },
    {
      id: "youtube-analytics-dashboard",
      name: "YouTube Channel Analytics Dashboard",
      subtitle: "Creator revenue tooling",
      category: "independent",
      summary: "A self-hosted analytics dashboard for running a monetized YouTube channel toward a revenue goal.",
      problem: "Managing a monetized YouTube channel toward a revenue goal required stitching together data YouTube Studio does not present in one place.",
      what: "Self-hosted analytics dashboard pulling channel and per-video data via OAuth, with an income goal tracker, Shorts vs long-form breakdown, upload consistency heatmap, performance scoring, and revenue projections. Installable as a mobile PWA.",
      stack: ["Python/Flask", "YouTube Data API v3", "YouTube Analytics API", "SQLite", "Chart.js", "Railway"],
      impact: null,
      demo: null
    },
    {
      id: "stackpine-aftercare",
      name: "Stackpine Aftercare",
      subtitle: "In development",
      category: "independent",
      status: "In development",
      oneLineOnly: true,
      summary: "Multi-tenant aftercare portal for funeral homes, giving every family a branded post-loss checklist, document vault, and guided next steps.",
      problem: null,
      what: null,
      stack: null,
      impact: null,
      demo: null
    }
  ],

  beyondSoftware: {
    heading: "Beyond software",
    items: [
      {
        title: "AI training curricula",
        text: "Three AI training curricula designed and facilitated: General AI Readiness, Recovery-Focused, and Leadership."
      },
      {
        title: "AI governance",
        text: "An AI Governance Policy authored for a compliance-heavy nonprofit."
      },
      {
        title: "Summit infrastructure",
        text: "Registration and payment infrastructure for a statewide AI leadership summit (GoHighLevel, Stripe)."
      }
    ]
  },

  cta: {
    heading: "Want systems like these in your organization?",
    button: "Get in Touch"
  },

  /* ---------- demo sample data (all fictional, all client-side) ---------- */
  demoData: {

    assistantChat: {
      label: "Simulated demo with sample data",
      caption: "The real system answers from an organization's own live documents with real retrieval, streaming, voice input, and production authentication.",
      intro: "Pick a sample question to see how the assistant responds.",
      exchanges: [
        {
          q: "How do I request time off?",
          a: "Submit a time off request to your supervisor at least two weeks before the requested dates. Requests are approved based on coverage, and you will receive a written confirmation once your supervisor signs off.",
          cites: ["Employee Handbook.pdf, Section 3: Time Off"]
        },
        {
          q: "What is the mileage reimbursement rate?",
          a: "Mileage for approved work travel is reimbursed at the standard rate listed in the travel policy. Log your trips on the mileage form and submit it with your monthly expense report for approval.",
          cites: ["Travel Policy.pdf, Section 2: Mileage"]
        },
        {
          q: "What should I do if the fire alarm goes off?",
          a: "Stop what you are doing, leave the building by the nearest marked exit, and gather at the designated assembly point in the parking area. Supervisors take a head count, and no one re-enters until the all-clear is given.",
          cites: ["Safety Procedures.docx, Section 1: Evacuation"]
        },
        {
          q: "Who approves purchases over $500?",
          a: "Purchases over $500 require written approval from a department director before the order is placed. Attach the approval to the purchase request so accounting can match it to the invoice.",
          cites: ["Purchasing Policy.pdf, Section 4: Approval Limits"]
        },
        {
          q: "What is the policy on personal stock trading?",
          a: "I could not find anything in the ingested documents that covers personal stock trading, so I cannot give you a reliable answer. If this policy exists, ask an administrator to upload it and I will be able to answer next time.",
          cites: [],
          decline: true
        }
      ]
    },

    emailTriage: {
      label: "Simulated demo",
      caption: "The real agent authenticates to Microsoft Graph, classifies live mail with an LLM, and files it continuously across multiple staff inboxes.",
      manualSecondsPerEmail: 9.6,
      agentSecondsPerEmail: 0.26,
      folders: ["Actionable", "Automated", "Spam"],
      emails: [
        { from: "Dana Whitfield", subject: "Question about tomorrow's schedule", type: "Actionable" },
        { from: "Billing, Brightline Supply", subject: "Your invoice is ready", type: "Automated" },
        { from: "Prize Alert Center", subject: "You have won a free cruise", type: "Spam" },
        { from: "Marcus Lee", subject: "Can you review this draft before noon?", type: "Actionable" },
        { from: "Industry Weekly", subject: "Newsletter: this week's roundup", type: "Automated" },
        { from: "IT Notifications", subject: "Password reset confirmation", type: "Automated" },
        { from: "Deals Unlimited", subject: "Exclusive offer just for you!!!", type: "Spam" },
        { from: "Priya Raman", subject: "Follow-up from this morning's call", type: "Actionable" },
        { from: "Backup Service", subject: "Nightly backup completed", type: "Automated" },
        { from: "Account Security Team", subject: "Urgent wire transfer needed", type: "Spam" }
      ]
    },

    resumeScorer: {
      label: "Simulated demo with fictional data",
      caption: "The real pipeline scores actual resumes with a locally hosted LLM on on-prem hardware so no PII leaves the building, and every result gets human review.",
      jobTitle: "Sample role: Operations Coordinator (fictional job description)",
      dimensions: ["JD match", "Behavioral adaptability", "AI/tech leverage"],
      note: "Scores are triage assist only. A human reviews every ranked result before anyone makes a decision.",
      candidates: [
        {
          name: "Avery Collins",
          blurb: "Six years coordinating logistics for a regional distributor",
          scores: [88, 72, 58],
          overall: 76,
          rationale: "Strong direct match on scheduling and vendor coordination, a solid record of adapting to new processes, and limited but growing use of automation tools."
        },
        {
          name: "Sam Delgado",
          blurb: "Recent graduate with two years in customer service",
          scores: [54, 81, 66],
          overall: 64,
          rationale: "Light on direct operations experience, but high adaptability signals and self-taught spreadsheet automation stand out for a junior hire."
        },
        {
          name: "Morgan Reyes",
          blurb: "Office manager who automated their own reporting",
          scores: [71, 68, 90],
          overall: 75,
          rationale: "Good operational overlap, steady adaptability, and exceptional initiative in automating recurring reports with scripts and templates."
        }
      ]
    },

    dashboardMock: {
      label: "Static mock with generic sample data",
      caption: "The real dashboards pull live data from Microsoft Graph, Smartsheet, and internal trackers behind staff sign-in.",
      tabs: [
        {
          id: "tasks",
          name: "Tasks",
          tiles: [["Open tasks", "24"], ["Due today", "6"], ["Overdue", "3"]],
          rows: [
            "Submit quarterly report draft, due Friday",
            "Approve supply order for Building 2",
            "Schedule onboarding session for new hire",
            "Review updated transportation checklist"
          ]
        },
        {
          id: "fleet",
          name: "Fleet",
          tiles: [["Vehicles active", "11"], ["Service due", "2"], ["Open issues", "1"]],
          rows: [
            "Van 3: oil change due at 62,500 miles",
            "Truck 1: registration renews next month",
            "Van 5: new tire installed, issue closed"
          ]
        },
        {
          id: "grants",
          name: "Grants",
          tiles: [["Active grants", "7"], ["Reports due in 30 days", "2"], ["Applications open", "4"]],
          rows: [
            "Quarterly outcomes report due on the 15th",
            "Renewal application draft in review",
            "Site visit scheduled for the 22nd"
          ]
        },
        {
          id: "comms",
          name: "Communications",
          tiles: [["Unread, shared inbox", "12"], ["Notifications sent today", "38"], ["Scheduled sends", "5"]],
          rows: [
            "Weekly staff update queued for Monday 8am",
            "Reminder batch sent to program leads",
            "Two bounced addresses flagged for cleanup"
          ]
        }
      ]
    },

    dgxDiagram: {
      label: "Simplified architecture diagram",
      caption: "The real deployment serves staff tools on the local network as persistent services, and no data leaves the building."
    }
  }
};
