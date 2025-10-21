# Orion4D MaskPro
***Éditeur de masques avancé pour ComfyUI, édition non destructive avec outils de sélection professionnels, pinceaux personnalisés PNG, aperçu embarqué et éditeur plein écran.****

<img width="1541" height="903" alt="image" src="https://github.com/user-attachments/assets/620e654b-7823-4321-8df1-424bf40fbe24" />

---

## ✨ Aperçu

`Orion4D_maskpro` apporte un éditeur de masques complet à ComfyUI avec :

- **Outils professionnels** : pinceau, lasso, polygone, rectangle, ellipse, dégradé, baguette magique
- **Pinceaux jusqu'à 2048 px** avec support PNG transparent et rotation
- **Historique complet** : Undo/Redo illimité
- **Navigation fluide** : zoom centré sur curseur, outil main (pan)
- **Traitements globaux** : flou de contour, dilatation/érosion, seuillage, détourage IA via `rembg`
- **Intégration seamless** : prévisualisation dans le node, éditeur en fenêtre dédiée

---

## 🚀 Fonctionnalités

### Édition interactive
- Éditeur web embarqué (`web/editor.html`) avec interface intuitive
- Aperçu dans le node avec modes *image / mask / rgba*
- Inversion du masque à la volée
- Sélections animées (fourmis marchantes)

### Outils de sélection avancés
- **Pinceau** : formes personnalisées, dureté, espacement, rotation
- **Lasso** : libre ou polygonal
- **Formes géométriques** : rectangle, ellipse avec contraintes
- **Dégradés** : linéaire ou radial
- **Baguette magique** : tolérance et lissage réglables

### Traitements intelligents
- **AI Cutout** : détection automatique du sujet via `rembg`
- **Morphologie** : dilatation, érosion, lissage
- **Seuillage** : sur image ou masque
- **Flou de contour** : pour des bords naturels

### Workflow optimisé
- Export PNG opaque (L 8-bit)
- Sauvegarde automatique dans le cache du node
- Navigation zoom/pan fluide
- Bibliothèque de pinceaux extensible

---

## 📦 Installation

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/orion4d/Orion4D_maskpro.git
# Redémarrer ComfyUI
```

**Pour le détourage IA :**
```bash
pip install rembg
```

---

## 🎯 Démarrage rapide

1. **Ajoutez le node** `MaskPro` à votre workflow
2. **Connectez** une image (optionnel) et/ou un masque (optionnel)
3. **Cliquez** sur `Edit Mask` dans le node
4. **Éditez** votre masque avec les outils disponibles
5. **Sauvegardez** avec `Save & Close`
6. **Exécutez** le workflow

**Priorité de masque :** `mask.png` édité > masque en entrée > masque vide

---

## 🔌 Entrées / Sorties

### Entrées
- `image` — IMAGE (optionnel) : image de référence
- `mask` — MASK (optionnel) : masque initial
- `invert_mask` — BOOLEAN : inversion du masque de sortie

### Sorties
- `mask` — MASK (0..1, **blanc = zone conservée**)
- `image` — IMAGE (passthrough ou image vide)
- `image_rgba` — IMAGE (avec canal alpha du masque appliqué)

> **Convention :** L'éditeur utilise le rouge en interne, mais la sortie respecte la convention ComfyUI : **blanc = conserver, noir = supprimer**

---

## ⌨️ Raccourcis clavier

### Navigation
| Touche | Action |
|--------|--------|
| **Molette** | Zoom centré sur le curseur |
| **Z** | Outil Zoom (Alt = zoom out) |
| **H** (maintenir) | Outil Main temporaire (pan) |
| **M** | Basculer mode "Mask Only" |

### Historique
| Touche | Action |
|--------|--------|
| **Ctrl+Z** | Annuler (Undo) |
| **Ctrl+Y** / **Ctrl+Shift+Z** | Refaire (Redo) |
| **Esc** | Effacer la sélection / Annuler polygone |

### Outils de peinture
| Touche | Action |
|--------|--------|
| **B** | Pinceau (Brush) |
| **L** | Lasso libre |
| **K** | Lasso polygonal |
| **E** | Ellipse |
| **S** | Rectangle (Square) |
| **G** | Dégradé (Gradient) |
| **W** | Baguette magique (Wand) |

### Actions rapides
| Touche | Action |
|--------|--------|
| **X** | Basculer mode Effacement |
| **A** | Remplir la sélection (Fill) |
| **C** | Effacer le masque (Clear) |
| **I** | Inverser le masque (Invert) |

---

## 🎨 Interface de l'éditeur

### Barre supérieure
- Contrôles de zoom
- Mode **Mask Only**
- Actions globales : Clear, Deselect, Fill, Invert
- Boutons **Export** et **Save & Close**

### Palette d'outils (gauche)
- Outils globaux
- Basculer mode Effacement
- Outil Main
- Outils de sélection/peinture avec infobulles

### Panneau de droite

#### Global Tools
- Flou de contour (Blur Contour)
- Lissage morphologique (Smooth)
- Dilatation / Érosion
- Seuillage image et masque
- **AI Cutout** (détourage automatique)

#### Brush Settings
- Taille : **1 à 2048 px**
- Dureté
- Opacité
- Espacement
- Forme : rond / carré / personnalisée
- Rotation (0-360°)
- Sélecteur de PNG personnalisé
- Grille de brosses

#### Selection Settings
- Auto-fill
- Mode centre / Contraintes (carré/cercle)
- Rayon d'arrondis
- Type de dégradé (linéaire/radial)
- Tolérance baguette magique
- Lissage (smoothing)

### Aperçu visuel
- Masque en **rouge semi-transparent** superposé
- Mode **Mask Only** : niveaux de gris
- **Fourmis marchantes** pour les sélections actives

---

## 🖌️ Pinceaux personnalisés

### Configuration
1. Placez vos fichiers PNG (avec canal alpha) dans `web/brushes/`
2. Dans l'éditeur, sélectionnez **Brush shape = Custom**
3. Chargez votre pinceau depuis le sélecteur
4. Ajustez la rotation si nécessaire

### Grille de pinceaux
- Cliquez sur **Brush Grid** pour afficher tous les pinceaux disponibles
- Sélection rapide par clic
- Liste chargée dynamiquement depuis `/orion4d_maskpro/list_brushes`

---

## 🔧 API HTTP

Le node expose plusieurs endpoints via AioHTTP :

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/orion4d_maskpro/editor` | Ouvre l'éditeur avec node_id |
| GET | `/orion4d_maskpro/open?node_id=<id>` | Récupère les métadonnées (image/mask, dimensions) |
| POST | `/orion4d_maskpro/save` | Sauvegarde image/mask dans le cache |
| GET | `/orion4d_maskpro/clear?node_id=<id>` | Supprime mask.png du cache |
| GET | `/orion4d_maskpro/list_brushes` | Liste les pinceaux disponibles |
| POST | `/orion4d_maskpro/rembg?node_id=<id>` | Détourage IA (requiert rembg) |

---

## 💾 Cache et fichiers

### Structure du cache
```
ComfyUI/user/orion4d_cache/maskpro_<NODE_ID>/
├── image.png   # Image de référence (optionnelle)
└── mask.png    # Masque édité (L 8-bit, opaque)
```

### Accès statique
Les fichiers sont servis via `/orion4d_maskpro/static/maskpro_<id>/...` pour l'éditeur et l'aperçu dans le node.

---

### Navigation
- **Zoom au curseur** + **touche H** pour explorer rapidement les grandes images
- Mode **Mask Only** pour vérifier la précision des bords

### Bibliothèque de pinceaux
- Créez une collection de formes organiques
- Préparez des pinceaux pour effets de bord
- Organisez vos PNG dans `web/brushes/`

### Performance
- Pour les images volumineuses, travaillez par zones avec zoom
- Utilisez les outils de sélection géométrique quand possible
- AI Cutout en premier pour gagner du temps

---

## 📄 Licence

Ce projet est publié sous licence **MIT**.

Vous êtes libre de l'utiliser, le modifier et le distribuer selon les termes de cette licence.

---

## 🙏 Crédits

**Conception & Développement**  
Orion4D / Philippe Joye

---

**⭐ Si ce projet vous est utile, n'hésitez pas à lui donner une étoile sur GitHub !**

</details>

</details>

---
<div align="center">

<h3>🌟 <strong>Show Your Support</strong></h3>
<p>If this project helped you, please consider giving it a ⭐ on GitHub!</p>
<p><strong>Made with ❤️ for the ComfyUI community</strong></p>
<p><strong>by Orion4D</strong></p>
<a href="https://ko-fi.com/orion4d">
<img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Buy Me A Coffee" height="41" width="174">
</a>

</div>
