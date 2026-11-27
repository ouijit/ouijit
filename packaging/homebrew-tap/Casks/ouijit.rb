cask "ouijit" do
  arch arm: "arm64", intel: "x64"

  version "1.11.2"
  sha256 arm:   "dc9cd452c338aadd850df6a2e4e19614346a29755833b32162121d1677ce7394",
         intel: "76c5e64d465bd07639818baa9b5aa34a31cf5092cc278f194b2543ddcc82dc92"

  url "https://github.com/ouijit/ouijit/releases/download/v#{version}/ouijit-darwin-#{arch}.dmg"
  name "Ouijit"
  desc "Git worktree-based task manager with terminals for CLI coding agents"
  homepage "https://ouijit.com/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: :ventura

  app "ouijit.app"

  zap trash: [
    "~/.config/Ouijit",
    "~/Library/Application Support/ouijit",
    "~/Library/Caches/com.electron.ouijit",
    "~/Library/Caches/com.electron.ouijit.ShipIt",
    "~/Library/HTTPStorages/com.electron.ouijit",
    "~/Library/Logs/ouijit",
    "~/Library/Preferences/com.electron.ouijit.plist",
    "~/Library/Saved Application State/com.electron.ouijit.savedState",
  ]
end
