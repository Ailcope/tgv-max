/**
 * « Seul le dernier a le droit d'écrire à l'écran. »
 *
 * Toutes les vues lancent une recherche à chaque frappe utile : changement de
 * gare, de date, de réglage. Deux recherches peuvent donc être en vol en même
 * temps, et rien ne garantit qu'elles reviennent dans l'ordre où elles sont
 * parties. La première qui traîne écrase alors la seconde, et l'écran finit par
 * montrer la réponse à une question qu'on ne pose plus.
 *
 * Chaque vue tient un jeton : `begin()` ouvre un tour et rend la fonction qui
 * dit s'il est toujours le dernier ouvert. Ce qui suit une attente se contente
 * de la consulter avant d'écrire.
 */
export class Latest {
  private turn = 0;

  /** Ouvre un tour. La fonction rendue dit s'il est encore d'actualité. */
  begin(): () => boolean {
    const mine = ++this.turn;
    return () => mine === this.turn;
  }

  /**
   * Périme les tours en cours sans en ouvrir un nouveau, pour le cas où la vue
   * décide de ne rien afficher du tout (recherche incomplète, gares
   * identiques) : ce qui est encore en vol ne doit pas ressurgir après coup.
   */
  cancel(): void {
    this.turn += 1;
  }
}
