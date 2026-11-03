package main

import (
	"archive/zip"
	"crypto/sha256"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"gopkg.in/yaml.v3"
)

var version = "1.1.1"

type settings struct {
	Plugin struct {
		ID string `yaml:"id"`
	} `yaml:"plugin"`
	Server struct {
		Address string `yaml:"address"`
	} `yaml:"server"`
	Host struct {
		BaseURL string `yaml:"base_url"`
		Secret  string `yaml:"secret"`
	} `yaml:"host"`
	Database struct {
		SQLitePath string `yaml:"sqlite_path"`
	} `yaml:"database"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	configPath := flag.String("config", "config.yaml", "plugin config")
	flag.Parse()
	configBody, err := os.ReadFile(*configPath)
	if err != nil {
		return err
	}
	var config settings
	if err = yaml.Unmarshal(configBody, &config); err != nil {
		return err
	}
	if config.Plugin.ID != "agent" || len(config.Host.Secret) < 32 {
		return errors.New("invalid agent plugin identity")
	}
	_, portText, found := strings.Cut(config.Server.Address, ":")
	if !found {
		return errors.New("invalid server address")
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return errors.New("invalid server port")
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	binary, err := os.Open(executable)
	if err != nil {
		return err
	}
	digest := sha256.New()
	_, err = io.Copy(digest, binary)
	closeErr := binary.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	// A replaced package can keep its version while containing a newer runtime.
	runtimeRoot := filepath.Join(filepath.Dir(*configPath), "runtime", version, fmt.Sprintf("%x", digest.Sum(nil)))
	if err = unpackRuntime(executable, runtimeRoot); err != nil {
		return err
	}
	dataDir := filepath.Join(filepath.Dir(*configPath), "data")
	sqlitePath := config.Database.SQLitePath
	if sqlitePath != "" {
		if !filepath.IsAbs(sqlitePath) {
			sqlitePath = filepath.Join(filepath.Dir(*configPath), sqlitePath)
		}
		dataDir = filepath.Dir(sqlitePath)
	} else {
		sqlitePath = filepath.Join(dataDir, "agent.sqlite")
	}
	command := exec.Command(filepath.Join(runtimeRoot, "node"), filepath.Join(runtimeRoot, "apps/server/dist/app.js"))
	command.Dir = runtimeRoot
	command.Stdout, command.Stderr = os.Stdout, os.Stderr
	command.Env = append(os.Environ(), "NODE_ENV=production", "AGENT_START_SERVER=1", "AGENT_PLUGIN_VERSION="+version, "AGENT_HOST=127.0.0.1", "AGENT_PORT="+strconv.Itoa(port),
		"AGENT_HOST_SECRET="+config.Host.Secret, "AIHUB_INTERNAL_URL="+config.Host.BaseURL,
		"AGENT_DATA_DIR="+dataDir, "AGENT_SQLITE_PATH="+sqlitePath, "AGENT_ASSETS_DIR="+filepath.Join(runtimeRoot, "apps/web/dist"))
	if err = command.Start(); err != nil {
		return err
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	go func() {
		if signal := <-signals; command.Process != nil {
			_ = command.Process.Signal(signal)
		}
	}()
	return command.Wait()
}

func unpackRuntime(executable, target string) error {
	if _, err := os.Stat(filepath.Join(target, ".complete")); err == nil {
		return nil
	}
	archive, err := zip.OpenReader(executable)
	if err != nil {
		return err
	}
	defer archive.Close()
	if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		return err
	}
	stage, err := os.MkdirTemp(filepath.Dir(target), ".agent-runtime-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	for _, file := range archive.File {
		if !strings.HasPrefix(file.Name, "runtime/") || file.FileInfo().Mode()&os.ModeType != 0 {
			return errors.New("invalid embedded runtime file")
		}
		if file.UncompressedSize64 > 150<<20 {
			return errors.New("embedded runtime file too large")
		}
		name := strings.TrimPrefix(file.Name, "runtime/")
		clean := filepath.Clean(name)
		if clean == "." || clean == ".." || filepath.IsAbs(clean) || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
			return errors.New("invalid embedded runtime path")
		}
		path := filepath.Join(stage, clean)
		if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return err
		}
		input, openErr := file.Open()
		if openErr != nil {
			return openErr
		}
		mode := os.FileMode(0600)
		if clean == "node" {
			mode = 0700
		}
		output, createErr := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
		if createErr != nil {
			input.Close()
			return createErr
		}
		written, copyErr := io.Copy(output, io.LimitReader(input, 150<<20+1))
		closeErr := output.Close()
		input.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if uint64(written) != file.UncompressedSize64 {
			return errors.New("incomplete embedded runtime file")
		}
	}
	if err = os.WriteFile(filepath.Join(stage, ".complete"), []byte(version), 0600); err != nil {
		return err
	}
	if err = os.Rename(stage, target); err != nil {
		if _, statErr := os.Stat(filepath.Join(target, ".complete")); statErr == nil {
			return nil
		}
		return err
	}
	return nil
}
