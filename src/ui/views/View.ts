/** A top-level tab view. Its `element` is created once; `activate()` runs on show. */
export interface View {
  readonly id: string;
  readonly label: string;
  readonly emoji: string;
  readonly hint: string;
  readonly element: HTMLElement;
  /** Called every time the view becomes visible (lazy first load, map resize…). */
  activate(): void;
  /** Optional: pre-fill the view from the command palette (origin, and destination if it takes one). */
  preset?(origin: string, destination?: string): void;
  /**
   * Les paramètres qui décrivent la recherche en cours, tels qu'ils voyageront
   * dans l'adresse de la page. Une vue qui n'a rien à partager s'en dispense.
   */
  state?(): Record<string, string>;
  /** L'inverse : reprendre une recherche lue dans l'adresse. */
  restore?(params: Record<string, string>): void;
  /**
   * Posée par l'application, appelée par la vue quand sa recherche change.
   * C'est ce qui tient l'adresse à jour sans que la vue ait à connaître
   * l'application ni le format de l'ancre.
   */
  onStateChange?: () => void;
}
