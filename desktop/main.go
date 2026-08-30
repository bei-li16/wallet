package main

import (
	"context"
	"embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows/registry"
)

//go:embed all:frontend/dist
var assets embed.FS

// App 暴露给前端的原生能力（通过 window.go.main.App 调用）
type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// PickSaveCsv 原生"另存为"对话框；取消返回 ""
func (a *App) PickSaveCsv(defaultName string) (string, error) {
	if strings.TrimSpace(defaultName) == "" {
		defaultName = "wallet-expenses.csv"
	}
	path, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		DefaultFilename: defaultName,
		Filters: []wruntime.FileFilter{
			{DisplayName: "CSV 文件 (*.csv)", Pattern: "*.csv"},
		},
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

// PickOpenCsv 原生"打开文件"对话框；取消返回 ""
func (a *App) PickOpenCsv() (string, error) {
	return wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Filters: []wruntime.FileFilter{
			{DisplayName: "CSV 文件 (*.csv)", Pattern: "*.csv"},
		},
	})
}

// ReadTextFile 读取文本文件（CSV 导入）
func (a *App) ReadTextFile(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("读取文件失败: %w", err)
	}
	return string(b), nil
}

// WriteTextFile 写入文本文件（CSV 同步/导出）
func (a *App) WriteTextFile(path string, content string) error {
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("文件路径为空")
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return fmt.Errorf("写入文件失败: %w", err)
	}
	return nil
}

// RevealInExplorer 在资源管理器中定位文件
func (a *App) RevealInExplorer(path string) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	if runtime.GOOS == "windows" {
		return exec.Command("explorer", "/select,", abs).Start()
	}
	return exec.Command("explorer", filepath.Dir(abs)).Start()
}

// DefaultCsvPath 返回建议的默认同步文件路径（系统文档目录下）
func (a *App) DefaultCsvPath() (string, error) {
	dir, err := documentsDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "wallet-expenses.csv"), nil
}

// documentsDir 读取注册表中"文档"文件夹的实际位置（可能被用户重定向），失败时回退 %USERPROFILE%\Documents
func documentsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	k, err := registry.OpenKey(
		registry.CURRENT_USER,
		`Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders`,
		registry.QUERY_VALUE,
	)
	if err == nil {
		defer k.Close()
		v, _, err := k.GetStringValue("Personal")
		if err == nil && v != "" {
			v = strings.ReplaceAll(v, "%USERPROFILE%", home)
			v = strings.ReplaceAll(v, "%HOMEDRIVE%%HOMEPATH%", home)
			if st, statErr := os.Stat(v); statErr == nil && st.IsDir() {
				return v, nil
			}
		}
	}
	return filepath.Join(home, "Documents"), nil
}

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "Wallet 记账本",
		Width:     1100,
		Height:    780,
		MinWidth:  860,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 15, G: 23, B: 42, A: 255}, // #0f172a
		OnStartup:        app.startup,
		Bind:             []interface{}{app},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			Theme:                windows.Dark,
		},
	})
	if err != nil {
		println("启动失败:", err.Error())
	}
}
