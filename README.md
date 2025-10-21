# Orion4D_maskpro — Éditeur de masques pour ComfyUI

> Édition de masques non destructifs, outils de sélection/peinture, pinceaux PNG personnalisés, aperçu embarqué dans le node et éditeur plein écran.

---

## Sommaire
- [Aperçu](#aperçu)
- [Fonctionnalités](#fonctionnalités)
- [Installation](#installation)
- [Démarrage rapide](#démarrage-rapide)
- [Entrées / Sorties du node](#entrées--sorties-du-node)
- [Raccourcis clavier](#raccourcis-clavier)
- [Interface de l’éditeur](#interface-de-léditeur)
- [Pinceaux personnalisés](#pinceaux-personnalisés)
- [API HTTP (routes)](#api-http-routes)
- [Cache et fichiers](#cache-et-fichiers)
- [Bonnes pratiques](#bonnes-pratiques)
- [Dépannage](#dépannage)
- [Changements à prévoir / Roadmap](#changements-à-prévoir--roadmap)
- [Licence](#licence)
- [Crédits](#crédits)

---

## Aperçu

`Orion4D_maskpro` ajoute un **éditeur de masques** à ComfyUI :
- Édition interactive (pinceau/lasso/polygone/rectangle/ellipse/gradient/baguette magique).
- Pinceaux **jusqu’à 2048 px**, support des **PNG transparents** + rotation.
- **Undo/Redo**, zoom à la molette centré sur le curseur, **outil main** (pan).
- Outils globaux : flou de contour, dilatation/érosion, seuillage (image/masque), **AI cutout via `rembg`**.
- Intégration node : **prévisualisation** de l’image/masque dans le node, bouton **Edit Mask** ouvrant l’éditeur en fenêtre dédiée.

**Références de code :** gestion des routes, cache et endpoints dans `maskpro.py` fileciteturn0file0 ; mappage du node et montage du répertoire web dans `__init__.py` fileciteturn0file1 ; squelette de README d’origine dans `README.md` (fourni) fileciteturn0file2.  
Les raccourcis et l’UI sont définis dans `web/editor.html` et `web/editor.js`/`web/editorbug.js` fileciteturn1file4 fileciteturn1file10.

---

## Fonctionnalités

- **Éditeur web intégré** (ouvre `web/editor.html`) avec tous les outils de sélection/peinture courants.
- **Aperçu dans le node** : modes *image / mask / rgba* + inversion du masque à l’aperçu (JS d’intégration) fileciteturn1file16.
- **AI Cutout (rembg)** : génère un masque initial via détection de sujet (si `rembg` est installé) fileciteturn0file0.
- **Export PNG opaque** (L 8‑bit) et **Save** vers le cache du node.
- **Historique** (Undo/Redo), **zoom** au curseur, **pan** (outil main), **sélections animées** (fourmis marchantes).

---

## Installation

1. Copier le dossier `Orion4D_maskpro` dans `ComfyUI/custom_nodes/` :
   ```text
   ComfyUI/custom_nodes/Orion4D_maskpro/
   ├─ __init__.py
   ├─ maskpro.py
   └─ web/
      ├─ editor.html
      ├─ editor.js (ou editorbug.js selon votre version)
      └─ brushes/            # (vos pinceaux PNG ici)
   ```

2. (Optionnel) **Rembg** pour l’AI cutout :
   ```bash
   pip install rembg
   ```

3. Redémarrer ComfyUI. Le node **MaskPro** apparaît dans la palette (section des custom nodes).

> Les routes HTTP et le répertoire web sont montés automatiquement à l’import (`register_routes()`) fileciteturn0file1.

---

## Démarrage rapide

1. Déposez **MaskPro** dans votre workflow et reliez une **image** (optionnelle) et/ou un **mask** (optionnel).
2. Cliquez sur **Edit Mask** (dans le node). L’éditeur s’ouvre avec l’image en référence.
3. Peignez/sélectionnez. Utilisez **Save & Close** pour enregistrer `mask.png` dans le cache du node.
4. Exécutez le workflow. La sortie **mask** (blanc = garder) est prête, et **image_rgba** applique l’alpha du masque.

Le node gère la priorité suivante pour le masque : **`mask.png` édité > mask en entrée > masque vide** (see README d’origine) fileciteturn0file2.

---

## Entrées / Sorties du node

- **Entrées**
  - `image` *(IMAGE, optionnel)*
  - `mask` *(MASK, optionnel)*
  - `invert_mask` *(BOOLEAN)*
- **Sorties**
  - `mask` *(MASK, 0..1, **blanc = garder**)*
  - `image` *(IMAGE, passthrough ou image vide)*
  - `image_rgba` *(IMAGE, alpha = masque)*

> Convention : l’éditeur peint en interne un « paint mask » (rouge) mais la **sortie node** respecte ComfyUI : **blanc = garder** (inversion gérée côté node) fileciteturn0file2.

---

## Raccourcis clavier

> **Note importante (correction infobulle)** : dans `editor.html`, l’info-bulle de l’**outil main** affiche _“Hand Tool (H or hold M)”_. Or le code lie **H** pour maintenir l’outil main (pan) ; **M** sert à **afficher le masque seul** (*Mask Only*). Il faut donc corriger l’infobulle en “**H or hold H**” / ou “**Hand Tool (H)**”. Réf. : infobulles HTML fileciteturn1file8 et gestion des touches dans `editor.js` (keydown) fileciteturn1file10.

**Navigation / global**
- **Molette** : zoom au niveau du curseur (lissage centré).  
- **Z** : Outil *Zoom* (Alt = zoom out visuel) fileciteturn1file10.  
- **H** (maintenir) : **Main (Pan)** temporaire, revient à l’outil précédent au relâchement fileciteturn1file10.  
- **M** : bascule **Mask Only** (affiche uniquement le masque) fileciteturn1file10.  
- **Ctrl+Z / Ctrl+Y** (ou **Ctrl+Shift+Z**) : **Undo / Redo** fileciteturn1file10.  
- **Esc** : **Clear Selection** et/ou annuler le polygone en cours fileciteturn1file10.

**Outils (sélection/peinture)**
- **B** : Pinceau *(Brush)*.  
- **L** : Lasso libre.  
- **K** : Lasso polygonal.  
- **E** : Ellipse.  
- **S** : Rectangle.  
- **G** : Dégradé linéaire/radial (selon réglage).  
- **W** : Baguette magique (tolérance/smoothing réglables).  
- **X** : bascule **Erase** (peindre en soustraction) fileciteturn1file10.
- **A** : **Fill Selection** (remplir la sélection courante avec l’opacité choisie) fileciteturn1file10.
- **C** : **Clear Mask** (remise à zéro) fileciteturn1file10.
- **I** : **Invert** le masque (255 – valeur) fileciteturn1file10.

> Les titres/infobulles par défaut visibles dans `editor.html` confirment la plupart des mappages (ex. *Brush (B)*, *Lasso (L)*, *Magic wand (W)*, *Zoom Tool (Z)*, etc.) fileciteturn1file11.

---

## Interface de l’éditeur

- **Top bar** : Zoom, **Mask Only**, Clear/Deselect/Fill/Invert, **Export**, **Save & Close** fileciteturn1file4.
- **Palette d’outils** (gauche) : *Global tools*, **Erase toggle**, **Hand**, **Brush/Lasso/Poly/Ellipse/Rect/Grad/Wand/Zoom** avec infobulles et lettres associées fileciteturn1file11.
- **Panneau droit** :
  - **Global Tools** : *Blur Contour*, *Smooth (morphology)*, *Dilate/Erode*, *Threshold (image & mask)*, **AI cutout** (bouton qui appelle `/rembg`) fileciteturn1file13.
  - **Brush Settings** : taille (jusqu’à **2048**), dureté, opacité, espacement, **forme round/square/custom**, **rotation**, **sélecteur de PNG personnalisé** et **grille de brosses**.
  - **Selection Settings** : options d’auto‑fill, mode centre/contraintes (carré/cercle), rayon d’arrondis, dégradé linéaire/radial, tolérance baguette, *smoothing*, etc.

- **Aperçu** :
  - Masque en **rouge semi‑transparent** sur l’image, **ou** en niveaux de gris (**Mask Only**).
  - **Fourmis marchantes** pour visualiser les bords de sélection (animation).

---

## Pinceaux personnalisés

- Placez vos PNG (avec alpha) dans `web/brushes/`.  
- Le menu **Brush shape = Custom** permet d’en charger un, **rotation** comprise.  
- Le bouton **Brush Grid** affiche la grille (chargée depuis `/orion4d_maskpro/list_brushes`) et permet de choisir rapidement fileciteturn0file0.

---

## API HTTP (routes)

Routes montées par `maskpro.py` (AioHTTP) :
- `GET  /orion4d_maskpro/editor` → redirige vers `web/editor.html?node_id=...` fileciteturn0file0.  
- `GET  /orion4d_maskpro/open?node_id=<id>` → métadonnées (présence `image.png`/`mask.png`, `w`,`h`) fileciteturn0file0.  
- `POST /orion4d_maskpro/save` (multipart `node_id`, `image?`, `mask?`) → enregistre les PNG dans le **cache** fileciteturn0file0.  
- `GET  /orion4d_maskpro/clear?node_id=<id>` → supprime `mask.png` du cache fileciteturn0file0.  
- `GET  /orion4d_maskpro/list_brushes` → liste `web/brushes/*.png` fileciteturn0file0.  
- `POST /orion4d_maskpro/rembg?node_id=<id>` → **AI cutout** (requiert `rembg`) fileciteturn0file0.

---

## Cache et fichiers

Le cache par **instance de node** est stocké dans :
```
ComfyUI/user/orion4d_cache/maskpro_<NODE_ID>/
├─ image.png   # image de référence (optionnelle, posée par le node avant l’édition)
└─ mask.png    # masque (L 8-bit, opaque)
```
Le node **sert** ces fichiers statiquement via `/orion4d_maskpro/static/maskpro_<id>/…` pour l’éditeur et la prévisualisation fileciteturn0file0.

---

## Bonnes pratiques

- Travaillez **plein écran** dans l’éditeur (fenêtre dédiée), puis **Save & Close**.
- Utilisez **Undo/Redo** généreusement lors des opérations globales (flou/dilatation/érosion/seuillages).
- Pour les grandes images : utilisez le **zoom au curseur** + **H** maintenu pour pan rapide.
- Préparez une **bibliothèque de brosses** dans `web/brushes/` (formes organiques, effets de bord, etc.).

---

## Dépannage

- **Le bouton AI cutout échoue** → installer `rembg` (`pip install rembg`).  
- **“image.png missing” dans l’éditeur** → lancez **Edit Mask** depuis le node (il envoie l’image en cache avant ouverture) fileciteturn1file12.  
- **Infobulle “Hand Tool (H or hold M)”** → c’est un libellé à corriger côté `editor.html`. Le comportement correct est **H** (maintenir) pour *Hand* et **M** pour *Mask Only* (toggle) fileciteturn1file8 fileciteturn1file10.

---


## Licence / Crédits

Ce projet est publié sous licence **MIT License Copyright (c) 2025 Philippe Joye (Orion4D)**. 

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
