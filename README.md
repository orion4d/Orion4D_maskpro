# Orion4D MaskPro
***Éditeur de masques avancé pour ComfyUI, édition non destructive avec outils de sélection professionnels, pinceaux personnalisés PNG, aperçu embarqué et éditeur plein écran.***

<img width="1541" height="903" alt="image" src="https://github.com/user-attachments/assets/620e654b-7823-4321-8df1-424bf40fbe24" />

---

## ✨ Aperçu

`Orion4D_maskpro` apporte un éditeur de masques complet à ComfyUI avec :

<img width="2546" height="1283" alt="image" src="https://github.com/user-attachments/assets/248722b5-03f6-4557-96a9-182a8fa10c0d" />
<img width="1824" height="1020" alt="image" src="https://github.com/user-attachments/assets/234794d6-5cc9-4cb6-ba28-285e267ab615" />

- **Outils professionnels** : pinceau, lasso, polygone, rectangle, ellipse, dégradé, baguette magique.
- **Pinceaux jusqu'à 2048 px** : support PNG transparent, rotation et lissage de trajectoire.
- **Historique complet** : Undo/Redo illimité ($Ctrl+Z$ / $Ctrl+Y$).
- **Navigation fluide** : zoom centré sur curseur, outil main ($pan$).
- **Traitements globaux** : flou de contour, dilatation/érosion, seuillage, détourage IA.
- **Intégration native** : prévisualisation temps réel dans le node (modes Image / Mask / RGBA) et éditeur dédié.

---

## 🚀 Fonctionnalités

### Édition interactive
- **Nouveau :** Prévisualisation dynamique dans le node avec support du ratio d'aspect.
- Inversion du masque à la volée.
- Sélections animées (fourmis marchantes).
- Option **Auto-run** : lance automatiquement le workflow après "Save & Close".

### Outils de sélection avancés
- **Pinceau** : formes personnalisées, dureté, espacement, rotation et **lissage (smoothing)**.
- **Lasso** : libre ou polygonal.
- **Formes géométriques** : rectangle (avec rayons d'arrondis), ellipse avec contraintes ($Ctrl$ pour cercle/carré parfait).
- **Dégradés** : linéaire ou radial avec contrôle d'opacité.
- **Baguette magique** : tolérance, moyenne de voisinage ($Average$) et lissage des bords.

### Traitements intelligents (AI)
- **BiRefNet Integration** : Support intégré pour le détourage via les modèles BiRefNet.
- **AI Cutout** : Détection automatique du sujet. Option pour fusionner le résultat avec le masque existant.
- **Rembg Support** : Support classique via `rembg`.
- **Morphologie** : dilatation, érosion, lissage global.

---

## 📦 Installation

```bash
cd ComfyUI/custom_nodes
git clone [https://github.com/orion4d/Orion4D_maskpro.git](https://github.com/orion4d/Orion4D_maskpro.git)
# Redémarrer ComfyUI
```

**Dépendances optionnelles :**
- Pour le détourage via `rembg` : `pip install rembg`
- Pour BiRefNet : Assurez-vous d'avoir les modèles dans `models/BiRefNet`.

---

## 🔌 Entrées / Sorties

### Entrées
- `image` — IMAGE (optionnel) : image de référence.
- `mask` — MASK (optionnel) : masque initial à éditer.
- `invert_mask` — BOOLEAN : inversion du masque de sortie.

### Sorties
- `mask` — MASK : (0..1, **blanc = zone conservée**).
- `image` — IMAGE : Passthrough de l'image originale.
- `image_rgba` — IMAGE : Image avec le masque appliqué en canal alpha.

---

## ⌨️ Raccourcis clavier

### Navigation & Sélection
| Touche | Action |
|--------|--------|
| **Molette** | Zoom centré sur le curseur |
| **Z** | Outil Zoom (Alt = dézoom) |
| **H** (maintenir) | Outil Main temporaire (pan) |
| **Space** | Pan |
| **Q** (maintenir) | Déplacer la sélection active au curseur |
| **Esc** | Effacer la sélection / Annuler polygone |

### Outils
| Touche | Action |
|--------|--------|
| **B** | Pinceau (Brush) |
| **L** | Lasso libre |
| **K** | Lasso polygonal |
| **W** | Baguette magique (Wand) |
| **G** | Dégradé (Gradient) |
| **X** | Basculer mode Effacement (Erase) |
| **A** | Remplir la sélection (Fill) |
| **I** | Inverser le masque (Invert) |

---

## 🎨 Bibliothèque de pinceaux

L'éditeur inclut désormais une **Grille de Pinceaux (Brush Grid)** :
1. Cliquez sur **Open brush grid** dans les réglages du pinceau.
2. Visualisez et sélectionnez vos brosses PNG instantanément.
3. Ajoutez vos propres fichiers dans `web/brushes/`.

---

## 🔧 Structure technique

Le node utilise un système de cache local pour garantir la persistance :
- `ComfyUI/user/orion4d_cache/maskpro_<NODE_ID>/`
- `image.png` : Référence de travail.
- `mask.png` : Masque haute précision (L 8-bit).

---

<div align="center">

### 🌟 **Soutenez le projet**
Si cet outil vous est utile, n'hésitez pas à laisser une ⭐ sur GitHub !

**Développé avec ❤️ pour la communauté ComfyUI par Orion4D**

<a href="https://ko-fi.com/orion4d">
<img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Buy Me A Coffee" height="41" width="174">
</a>

</div>
