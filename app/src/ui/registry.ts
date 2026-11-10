// Shared presentation components. The catalogue consumes the same exports as the future application.
export const componentRegistry = [
  {
    id: "UI-038",
    name: "EventChoiceView / OptionalEventPreviewLink",
    purpose: "Explicit QR or no-event choice and draft resumption; #optional-event",
  },
  {
    id: "UI-037",
    name: "LegalDocumentView / LegalFooter / AperAILogo",
    purpose: "Public legal documents and navigation; #legal/privacy and #legal/terms",
  },
  {
    id: "UI-036",
    name: "InstallationHelpView / OfflineFallbackView / MobileSupportLink / MobilePreviewLink",
    purpose: "Optional installation, manual help and data-free offline fallback; #mobile",
  },
  {
    id: "UI-035",
    name: "ModerationListView / ModerationProjectView / ModerationPreviewLink / ModerationNavigation",
    purpose: "Platform moderation, reasoned hide/restore, audit and recovery; #moderation",
  },
  {
    id: "UI-034",
    name: "PublicationLifecycleEditor / PublicationRevisionReview / PublicationWithdrawView / LifecyclePublicView / PublicationLifecyclePreviewLink",
    purpose: "Owner public updates, withdrawal and explicit republishing; #publication-lifecycle",
  },
  {
    id: "UI-033",
    name: "BrandLogo / PromptFlag",
    purpose: "Sage & Copper 00 retained identity; #share/home, #access/sign-in and #gallery",
  },
  {
    id: "UI-032",
    name: "GalleryView / GalleryDetailView / GalleryAgentView / GalleryJsonView / GalleryPreviewLink",
    purpose: "Public browsing, basic search, detail navigation and read-only agent guide; #gallery",
  },
  {
    id: "UI-031",
    name: "ProjectDeleteAction / ProjectDeleteView / OwnerPublishedProjectView / ProjectDeletionNotice / ProjectDeletionPreviewLink",
    purpose: "Owner project deletion confirmation and safe recovery; #delete-project",
  },
  {
    id: "UI-030",
    name: "DraftAgentEditorView / DraftAgentHandoffView / DraftAgentPreviewLink",
    purpose:
      "Existing private draft refinement with current-content handoff and owner review; #refine",
  },
  {
    id: "UI-029",
    name: "PitchRecoveryView / PitchRecoveryEditorView / PitchRecoveryPreviewLink",
    purpose: "Private retained audio, explicit retry and expiry; #recovery",
  },
  {
    id: "UI-027",
    name: "PublicationEditorView / PublicationOptionsView / PublicationReviewView / PublicationSuccessView",
    purpose: "Saved project, chosen public content and explicit publication; #publish/start",
  },
  {
    id: "UI-028",
    name: "PublicProjectContentView / PublicEventProjectsView / PublicationPreviewLink",
    purpose: "Shared public preview/detail, event projects and catalogue entry; #publish/start",
  },
  {
    id: "UI-026",
    name: "UnfinishedProjectsView / UpgradeRecoveryView / ReauthenticationView",
    purpose:
      "Explicit cross-device project choice and protected upgrade/session recovery; #share/home",
  },
  {
    id: "UI-025",
    name: "AgentHandoffView / AgentSteps",
    purpose: "Single-proposal upload instructions, waiting, review and recovery; #share/home",
  },
  {
    id: "UI-024",
    name: "PitchRecorderView",
    purpose: "30-second recorder, pause/resume/finish and reminder controls; #share/home",
  },
  {
    id: "UI-022",
    name: "ShareShell / ShareHomeView / LinkedEventsView / EventLinkedView / OwnProjectsView",
    purpose:
      "Sharing-first page, linked events, selection and private project history; #share/home",
  },
  {
    id: "UI-023",
    name: "EventCaptureView / ShareMessageView / RetainedProjectView / SharePreviewLink",
    purpose: "Event-scoped capture, recovery and catalogue entry; #share/home",
  },
  { id: "UI-001", name: "Button", purpose: "Primary, secondary and quiet actions" },
  { id: "UI-002", name: "Tag", purpose: "Compact capability and status labels" },
  { id: "UI-003", name: "Avatar", purpose: "Author identity without external images" },
  { id: "UI-004", name: "ProjectMark", purpose: "Project identity" },
  { id: "UI-005", name: "ProjectCard", purpose: "Discovery summary, save and open" },
  { id: "UI-006", name: "ProjectStory", purpose: "Approved public description" },
  { id: "UI-007", name: "AuthorCard", purpose: "Author-selected public contact" },
  { id: "UI-008", name: "Field / TextInput", purpose: "Labelled author inputs" },
  { id: "UI-009", name: "EmptyState", purpose: "No results and empty collections" },
  { id: "UI-010", name: "Stepper", purpose: "Submission progress" },
  { id: "UI-011", name: "Icon", purpose: "Local SVG interface symbols" },
  {
    id: "UI-012",
    name: "AccountMenu",
    purpose: "Signed-in account navigation and role-gated Admin entry",
  },
  {
    id: "UI-013",
    name: "SignInView",
    purpose: "Shared provider/email sign-in and recoverable errors",
  },
  {
    id: "UI-014",
    name: "AccessDeniedView",
    purpose: "Unavailable admin access without private data",
  },
  {
    id: "UI-015",
    name: "AdminEntryView",
    purpose: "Event-management landing after authorized menu entry",
  },
  {
    id: "UI-016",
    name: "AdminScanView",
    purpose: "Mobile event QR scan, permission fallback and pasted link",
  },
  {
    id: "UI-017",
    name: "AdminReviewView",
    purpose: "Event details and explicit submission-window pickers",
  },
  {
    id: "UI-018",
    name: "AdminConfirmationView",
    purpose: "Whitelist/save receipt and onward navigation",
  },
  {
    id: "UI-019",
    name: "IntegrationSettingsView",
    purpose: "Admin processor settings with write-only credential fields",
  },
  {
    id: "UI-020",
    name: "CaptureChoices / ProjectEditor / ProjectDetailsEditor",
    purpose: "Shared private project capture and optional structured fields",
  },
  {
    id: "UI-021",
    name: "EventScannerView",
    purpose: "Event camera entry, permission feedback and paste fallback",
  },
] as const;
