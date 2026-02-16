# Dropboard

# 公開ページ
https://qk777.github.io/Dropboard/
 <br> <br>

ブラウザだけで動く、画像ボード（Dropboard） と 画像メモ閲覧（Memomo） の統合ツールです。 <br>
画像をドロップして追加すると「ウィンドウ」になり、ドラッグで配置したり、画像の上に付箋メモを重ねて保存できます。 <br>
 <br>

✅ 2つのモード <br>
Dropboard：自由配置できる画像ボード（ウィンドウを並べて整理） <br>
Memomo：サイドバー（サムネ）で画像を素早く切り替えてメモ管理  <br>
 <br>
✅ Dropboard <br>
ボードを複数ページに分けて整理できます（前/次・追加）。 <br>
 <br>

✅ 付箋メモ（画像に重ねる） <br>
メモは 画像の上（オーバーレイ） に配置でき、移動・リサイズ可能 <br>
ダブルクリック / ダブルタップで編集 <br>
色 / 透明度 / 文字サイズ / 太字などの調整（ノートパネル） <br>
Dropboard と Memomo でメモを分離して保持（モード別メモ） <br>
 <br>
✅ 切り取り（Crop）ビュー <br>
画像の注目部分だけを拡大表示する「切り取り」機能。 <br>
Crop ON/OFF 切替 <br>
ドラッグで範囲選択して切り取り領域を指定 <br>
ダブルクリックでリセット <br>
 <br>
✅ 自動保存（IndexedDB） <br>
状態は IndexedDB に保存され、リロードしても復元できます（実装は dropboard DB に保存）。 <br>
 <br>
✅ HEIC/HEIF対応（条件あり） <br>
HEIC/HEIF は heic2any を利用して PNG に変換します。ライブラリが読めない場合はエラー表示されます（オフライン等）。 <br>
 <br> <br>


キーボードショートカット <br>
Ctrl/Cmd + M：Dropboard ⇄ Memomo 切替 <br>
N：付箋メモ追加（編集モード時） <br>
Ctrl/Cmd + E：編集モード ON/OFF <br>
← / →（PageUp / PageDown）：Memomoで前後移動 <br>
 <br> <br>


注意点 / Issues <br>
・印刷/PDFは現状機能していません。 <br>
・HEIC/HEIF 変換は heic2any が必要です（読み込まれていないと変換できません）。 <br>
・ブラウザのストレージ制限やプライベートモードでは保存が失敗する場合があります（IndexedDB）。 <br>
