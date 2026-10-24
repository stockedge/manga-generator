# GitHubでの利用状況の見方

公開リポジトリ：[stockedge/manga-generator](https://github.com/stockedge/manga-generator)。2026年10月24日11時16分ごろ（日本時間）に公式APIで **66 stars、12 forks**、Topics 5件を確認した。GitHub上の作成日時は2026年10月22日11時58分（日本時間）。この数値はその時点の記録であり、継続利用や開発参加を示すものではない。

管理権限のある `gh` 認証を使い、以下で時点別のスナップショットを保存する。

```sh
node tools/github-metrics.mjs stockedge/manga-generator
```

出力先は `docs/metrics/` の時刻付きJSON。stars・forks・Topicsと、[GitHub Traffic API](https://docs.github.com/en/rest/metrics/traffic)のviews・clones・流入元を原文に近い形で保存する。[GitHubの説明](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-traffic-to-a-repository)では訪問・クローンは過去14日間、日付はUTC、訪問とクローンは時間単位、流入元は日単位で更新される。日別の`uniques`を足して期間のユニーク人数とみなさない。APIへのアクセス権がなければ、GitHubの **Insights → Traffic** で同じ項目を確認する。

比較日はリポジトリ作成から**7日目の10月29日**、**14日目の11月5日**（日本時間）を目安にする。各日に同じコマンドを実行し、stars・forksの増分と、Trafficの訪問・クローン・流入元の傾向を見る。Xから来た読者がGitHub内で作品や導入手順を見つけ、試せているかを判断するための補助指標であり、フォーク数だけから実利用を推定しない。

同日作成リポジトリ内の順位や全公開リポジトリ内の上位率は、検索の欠落や分母の不確実性が大きいため、定期比較の主要指標にはしない。
